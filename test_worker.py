import asyncio
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from telegram_worker import ActiveClientManager


class ManagerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.env = patch.dict('os.environ', {'TELEGRAM_API_ID': '123', 'TELEGRAM_API_HASH': 'hash'})
        self.env.start()
        self.backend = AsyncMock()
        self.manager = ActiveClientManager(self.backend)

    async def asyncTearDown(self):
        self.env.stop()

    @patch('telegram_worker.StringSession', return_value=MagicMock())
    @patch('telegram_worker.TelegramClient')
    async def test_start_is_idempotent_and_account_bound(self, client_type, _session_type):
        client = MagicMock()
        client.connect = AsyncMock()
        client.is_user_authorized = AsyncMock(return_value=True)
        client.disconnect = AsyncMock()
        client.is_connected.return_value = True
        client_type.return_value = client
        self.backend.account.return_value = {'id': 27, 'session': 'saved-session'}
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
        self.backend.account.return_value = {'id': 28, 'session': 'revoked'}
        self.assertFalse(await self.manager.start_account(28))
        self.assertEqual([], self.manager.running_account_ids())
        self.backend.set_status.assert_any_await(28, 'revoked')


if __name__ == '__main__':
    unittest.main()
