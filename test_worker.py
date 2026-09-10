import asyncio
import os
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from telegram_worker import ActiveClientManager, S3MediaStorage


class ManagerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.env = patch.dict('os.environ', {'TELEGRAM_API_ID': '123', 'TELEGRAM_API_HASH': 'hash',
                                             'AWS_REGION': 'us-east-1', 'S3_BUCKET_NAME': 'private-test'})
        self.env.start()
        self.backend = AsyncMock()
        with patch('telegram_worker.S3MediaStorage', return_value=MagicMock()):
            self.manager = ActiveClientManager(self.backend)

    async def asyncTearDown(self):
        self.env.stop()

    async def test_text_disabled_preserves_media_without_caption_and_skips_empty_messages(self):
        self.manager.clients[27] = SimpleNamespace(user_id=14)
        self.backend.storage_settings.return_value = dict(save_text=False, save_photos=True,
            save_videos=True, save_audio=True, save_files=True, save_pdfs=True, max_file_size_mb=None)
        self.manager._download_media = AsyncMock(return_value={'s3_key': 'test', '_temp_path': 'temp'})
        event = SimpleNamespace(get_sender=AsyncMock(return_value=None), get_chat=AsyncMock(return_value=None),
            chat_id=1, message=SimpleNamespace(id=2), raw_text='private caption',
            is_channel=False, is_group=False, out=False, date=MagicMock())
        await self.manager._process_event(27, event)
        payload = self.backend.ingest.call_args.args[0]
        self.assertIsNone(payload['text'])
        self.assertEqual(payload['media'], {'s3_key': 'test'})
        self.manager._download_media.return_value = None
        self.backend.ingest.reset_mock()
        await self.manager._process_event(27, event)
        self.backend.ingest.assert_not_called()
        self.backend.storage_settings.side_effect = RuntimeError('backend unavailable')
        self.manager._download_media.reset_mock()
        with self.assertRaises(RuntimeError):
            await self.manager._process_event(27, event)
        self.manager._download_media.assert_not_called()

    @patch('telegram_worker.StringSession', return_value=MagicMock())
    @patch('telegram_worker.TelegramClient')
    async def test_start_is_idempotent_and_account_bound(self, client_type, _session_type):
        client = MagicMock()
        client.connect = AsyncMock()
        client.is_user_authorized = AsyncMock(return_value=True)
        client.disconnect = AsyncMock()
        client.is_connected.return_value = True
        client_type.return_value = client
        self.backend.account.return_value = {'id': 27, 'user_id': 14, 'session': 'saved-session'}
        self.assertTrue(await self.manager.start_account(27))
        self.assertFalse(await self.manager.start_account(27))
        self.assertEqual([27], self.manager.running_account_ids())
        client.add_event_handler.assert_called_once()

    @patch('telegram_worker.StringSession', return_value=MagicMock())
    @patch('telegram_worker.TelegramClient')
    async def test_revoked_session_does_not_become_active(self, client_type, _session_type):
        client = MagicMock()
        client.connect = AsyncMock()
        client.is_user_authorized = AsyncMock(return_value=False)
        client.disconnect = AsyncMock()
        client_type.return_value = client
        self.backend.account.return_value = {'id': 28, 'user_id': 14, 'session': 'revoked'}
        self.assertFalse(await self.manager.start_account(28))
        self.assertEqual([], self.manager.running_account_ids())
        self.backend.set_status.assert_any_await(28, 'revoked')


class MediaStorageTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {'AWS_REGION': 'us-east-1', 'S3_BUCKET_NAME': 'private-test'})
        self.env.start()
        self.s3 = MagicMock()
        self.storage = S3MediaStorage(self.s3)

    def tearDown(self):
        self.env.stop()

    @staticmethod
    def event(chat_id, message_id, mime_type, filename=None, **flags):
        event = SimpleNamespace(
            chat_id=chat_id,
            message=SimpleNamespace(id=message_id),
            media=SimpleNamespace(document=SimpleNamespace(mime_type=mime_type)),
            file=SimpleNamespace(name=filename, mime_type=mime_type,
                                 ext=Path(filename).suffix if filename else None),
            photo=flags.get('photo'), video=flags.get('video'), audio=flags.get('audio'),
            sticker=flags.get('sticker'), voice=flags.get('voice'))

        async def download_media(file):
            Path(file).write_bytes(b'telegram-media')
            return file
        event.download_media = download_media
        return event

    async def test_image_video_document_keys_are_isolated_and_collision_resistant(self):
        cases = [
            (14, 27, self.event(100, 55, 'image/jpeg', photo=True), '/images/'),
            (15, 27, self.event(100, 55, 'video/mp4', video=True), '/videos/'),
            (14, 28, self.event(200, 55, 'application/pdf', 'Quarterly Report.pdf'), '/documents/'),
        ]
        keys = []
        temp_paths = []
        for user_id, account_id, event, category in cases:
            result = await self.storage.archive(user_id, account_id, event)
            keys.append(result['s3_key'])
            temp_paths.append(result['_temp_path'])
            self.assertIn(f'users/{user_id}/telegram_accounts/{account_id}{category}', result['s3_key'])
        self.assertEqual(3, len(set(keys)))
        self.assertIn('200_55_Quarterly_Report.pdf', keys[2])
        for path in temp_paths:
            self.assertTrue(Path(path).exists())
        for path in temp_paths:
            self.storage.cleanup({'_temp_path': path})
            self.assertFalse(Path(path).exists())

    async def test_duplicate_message_ids_in_different_chats_do_not_collide(self):
        first = await self.storage.archive(14, 27, self.event(100, 9, 'image/jpeg', photo=True))
        second = await self.storage.archive(14, 27, self.event(101, 9, 'image/jpeg', photo=True))
        self.assertNotEqual(first['s3_key'], second['s3_key'])
        Path(first['_temp_path']).unlink()
        Path(second['_temp_path']).unlink()

    async def test_disabled_categories_never_download(self):
        for mime, filename, flag, flags in [
            ('image/jpeg', 'a.jpg', 'save_photos', {}),
            ('video/mp4', 'a.mp4', 'save_videos', {}),
            ('audio/ogg', 'a.ogg', 'save_audio', {'voice': True}),
            ('image/webp', 'a.webp', 'save_files', {'sticker': True}),
            ('application/pdf', 'a', 'save_pdfs', {}),
            ('application/octet-stream', 'a.PDF', 'save_pdfs', {}),
        ]:
            event = self.event(1, 1, mime, filename, **flags)
            event.download_media = AsyncMock()
            self.assertIsNone(await self.storage.archive(1, 1, event, {flag: False}))
            event.download_media.assert_not_called()
        self.s3.upload_file.assert_not_called()

    async def test_pdf_is_independent_of_other_files(self):
        event = self.event(1, 1, 'application/pdf', 'a.pdf')
        media = await self.storage.archive(1, 1, event, {'save_files': False, 'save_pdfs': True})
        self.assertIsNotNone(media)
        self.storage.cleanup(media)

    async def test_size_limit_before_download_and_after_download(self):
        event = self.event(1, 1, 'video/mp4', 'a.mp4')
        event.file.size = 1000001
        event.download_media = AsyncMock()
        self.assertIsNone(await self.storage.archive(1, 1, event, {'max_file_size_mb': 1}))
        event.download_media.assert_not_called()
        observed = []
        async def download(file, progress_callback):
            observed.append(file)
            Path(file).write_bytes(b'x' * 1000001)
            return file
        event.file.size = None
        event.download_media = download
        self.assertIsNone(await self.storage.archive(1, 1, event, {'max_file_size_mb': 1}))
        self.assertFalse(Path(observed[0]).exists())
        self.s3.upload_file.assert_not_called()

    async def test_exact_size_limit_and_progress_cancellation(self):
        event = self.event(1, 1, 'video/mp4', 'a.mp4')
        observed = []
        async def download(file, progress_callback):
            observed.append(file)
            Path(file).write_bytes(b'x' * 1000000)
            progress_callback(1000000, 1000000)
            return file
        event.download_media = download
        media = await self.storage.archive(1, 1, event, {'max_file_size_mb': 1})
        self.assertEqual(media['file_size'], 1000000)
        self.storage.cleanup(media)
        self.s3.upload_file.reset_mock()
        async def oversized(file, progress_callback):
            observed.append(file)
            progress_callback(1000001, None)
        event.download_media = oversized
        self.assertIsNone(await self.storage.archive(1, 1, event, {'max_file_size_mb': 1}))
        self.assertFalse(Path(observed[-1]).exists())
        self.s3.upload_file.assert_not_called()

    async def test_failed_s3_upload_is_handled_and_temp_file_is_cleaned(self):
        observed = []
        def fail(path, *_args):
            observed.append(path)
            raise RuntimeError('simulated S3 outage')
        self.s3.upload_file.side_effect = fail
        result = await self.storage.archive(14, 27, self.event(100, 56, 'image/jpeg', photo=True))
        self.assertIsNone(result)
        self.assertEqual(1, len(observed))
        self.assertFalse(Path(observed[0]).exists())


if __name__ == '__main__':
    unittest.main()
