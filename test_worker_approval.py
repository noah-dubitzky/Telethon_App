import asyncio
import os
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, MagicMock, patch
from telegram_worker import ActiveClientManager


class ApprovalTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.env = patch.dict(os.environ, {'TELEGRAM_API_ID': '123', 'TELEGRAM_API_HASH': 'hash'})
        self.env.start()
        self.backend = AsyncMock()
        with patch('telegram_worker.S3MediaStorage', return_value=MagicMock()):
            self.manager = ActiveClientManager(self.backend)

    async def asyncTearDown(self):
        await self.manager.close()
        self.env.stop()

    def active(self, account_id, user_id, version=0):
        client = SimpleNamespace(disconnect=AsyncMock())
        self.manager.clients[account_id] = SimpleNamespace(client=client, user_id=user_id, auth_version=version)
        return client

    async def test_suspension_disconnects_every_account_of_owner_and_cancels_events(self):
        first = self.active(1, 10)
        second = self.active(2, 10)
        other = self.active(3, 20)
        task = asyncio.create_task(asyncio.Event().wait())
        self.manager.event_tasks[1] = {task}
        self.backend.eligibility.return_value = [{'id': 3, 'auth_version': 0}]
        await self.manager.reconcile_approval()
        first.disconnect.assert_awaited_once()
        second.disconnect.assert_awaited_once()
        other.disconnect.assert_not_awaited()
        self.assertTrue(task.cancelled())
        self.assertEqual(self.manager.running_account_ids(), [3])

    async def test_fast_reapproval_does_not_resurrect_old_worker_generation(self):
        client = self.active(1, 10, 4)
        self.backend.eligibility.return_value = [{'id': 1, 'auth_version': 5}]
        await self.manager.reconcile_approval()
        client.disconnect.assert_awaited_once()
        self.assertEqual(self.manager.running_account_ids(), [])

    async def test_graceful_shutdown_preserves_database_state_for_startup_restoration(self):
        client = self.active(1, 10)
        await self.manager.close()
        client.disconnect.assert_awaited_once()
        self.backend.set_status.assert_not_awaited()
        self.assertEqual(self.manager.running_account_ids(), [])

    async def test_database_failure_disconnects_all_and_filter_failure_stops_processing(self):
        client = self.active(1, 10)
        self.backend.eligibility.side_effect = RuntimeError('offline')
        await self.manager.reconcile_approval()
        client.disconnect.assert_awaited_once()
        event = SimpleNamespace(get_sender=AsyncMock(return_value=None), get_chat=AsyncMock(return_value=None), chat_id=5)
        self.backend.filter_allowed.side_effect = RuntimeError('offline')
        await self.manager._process_event(1, event)
        self.backend.storage_settings.assert_not_awaited()
        self.backend.ingest.assert_not_awaited()


if __name__ == '__main__':
    unittest.main()
