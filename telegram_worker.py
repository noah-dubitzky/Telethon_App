"""One-process, multi-session Telethon ingestion worker."""
import asyncio
import logging
import os
from dataclasses import dataclass
from pathlib import Path
from zoneinfo import ZoneInfo

from telethon import TelegramClient, events
from telethon.sessions import StringSession
from telethon.tl.types import Channel, Chat, User

from worker_http import BackendClient, ControlServer

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("telesaver.worker")


def display_name(entity):
    if isinstance(entity, User):
        return entity.username or " ".join(filter(None, [entity.first_name, entity.last_name])) or "Unknown"
    if isinstance(entity, (Channel, Chat)):
        return getattr(entity, "title", None) or getattr(entity, "username", None) or "Unknown"
    return "Unknown"


@dataclass
class ActiveClient:
    client: TelegramClient
    account_id: int


class ActiveClientManager:
    def __init__(self, backend):
        api_id = os.getenv("TELEGRAM_API_ID", "")
        self.api_id = int(api_id) if api_id.isdigit() else 0
        self.api_hash = os.getenv("TELEGRAM_API_HASH", "")
        if not self.api_id or not self.api_hash:
            raise RuntimeError("TELEGRAM_API_ID and TELEGRAM_API_HASH are required")
        self.backend = backend
        self.clients = {}
        self.locks = {}
        self.media_root = Path(os.getenv("MEDIA_ROOT", "my-node-server/public/uploads"))
        self.timezone = ZoneInfo(os.getenv("ARCHIVE_TIMEZONE", "America/New_York"))

    def running_account_ids(self):
        return sorted(self.clients)

    async def restore_all(self):
        accounts = await self.backend.eligible_accounts()
        results = await asyncio.gather(*(self.start_account(int(a["id"])) for a in accounts), return_exceptions=True)
        for account, result in zip(accounts, results):
            if isinstance(result, Exception):
                log.error("account=%s startup failed type=%s", account["id"], type(result).__name__)

    async def start_account(self, account_id, account=None):
        lock = self.locks.setdefault(account_id, asyncio.Lock())
        async with lock:
            active = self.clients.get(account_id)
            if active and active.client.is_connected():
                return False
            await self.backend.set_status(account_id, "starting")
            client = None
            try:
                account = account or await self.backend.account(account_id)
                client = TelegramClient(StringSession(account["session"]), self.api_id, self.api_hash,
                                         auto_reconnect=True, connection_retries=None, retry_delay=2)
                client.add_event_handler(self._handler(account_id), events.NewMessage)
                await client.connect()
                if not await client.is_user_authorized():
                    await client.disconnect()
                    await self.backend.set_status(account_id, "revoked")
                    log.warning("account=%s session revoked", account_id)
                    return False
                self.clients[account_id] = ActiveClient(client, account_id)
                await self.backend.set_status(account_id, "connected")
                log.info("account=%s started", account_id)
                return True
            except Exception:
                if client:
                    await client.disconnect()
                await self.backend.set_status(account_id, "error")
                raise

    async def stop_account(self, account_id, status="disconnected"):
        lock = self.locks.setdefault(account_id, asyncio.Lock())
        async with lock:
            active = self.clients.pop(account_id, None)
            if active:
                await active.client.disconnect()
            await self.backend.set_status(account_id, status)
            log.info("account=%s stopped", account_id)
            return active is not None

    async def restart_account(self, account_id):
        await self.stop_account(account_id)
        return await self.start_account(account_id)

    async def close(self):
        await asyncio.gather(*(active.client.disconnect() for active in list(self.clients.values())), return_exceptions=True)
        self.clients.clear()

    def _handler(self, account_id):
        async def handle(event):
            try:
                await self._process_event(account_id, event)
            except Exception as error:
                log.error("account=%s event failed type=%s", account_id, type(error).__name__)
        return handle

    async def _process_event(self, account_id, event):
        sender, chat = await asyncio.gather(event.get_sender(), event.get_chat())
        sender_name = display_name(sender) if isinstance(sender, User) else None
        channel_name = display_name(chat) if isinstance(chat, (Channel, Chat)) else None
        sender_id = sender.id if isinstance(sender, User) else None
        channel_id = chat.id if isinstance(chat, (Channel, Chat)) else None
        filter_payload = {"telegram_account_id": account_id, "external_sender_id": str(sender_id) if sender_id else None,
                          "sender_name": sender_name, "channel_key": channel_name, "telegram_chat_id": event.chat_id}
        try:
            if not await self.backend.filter_allowed(filter_payload):
                return
        except Exception as error:
            log.warning("account=%s filter check failed-open type=%s", account_id, type(error).__name__)
        media_path = await self._download_media(account_id, event)
        payload = {
            "telegram_account_id": account_id,
            "telegram_message_id": event.message.id if event.message else None,
            "telegram_chat_id": event.chat_id,
            "sender_name": sender_name or channel_name or "Unknown",
            "sender_phone": getattr(sender, "phone", None) or "Unknown",
            "sender_id": sender_id,
            "channel_name": channel_name,
            "channel_id": channel_id,
            "is_channel_post": bool(event.is_channel and not event.is_group),
            "text": (event.raw_text or "").strip() or " ",
            "media_path": media_path,
            "timestamp": event.date.astimezone(self.timezone).strftime("%Y-%m-%d %H:%M:%S"),
        }
        await self.backend.ingest(payload)
        log.info("account=%s message=%s archived", account_id, payload["telegram_message_id"])

    async def _download_media(self, account_id, event):
        if not event.media:
            return None
        mime = getattr(getattr(event.media, "document", None), "mime_type", "") or ""
        kind = "videos" if mime.startswith("video/") else "images"
        target = self.media_root / str(account_id) / kind
        target.mkdir(parents=True, exist_ok=True)
        return await event.download_media(file=str(target))


async def run():
    backend = BackendClient()
    await backend.open()
    manager = ActiveClientManager(backend)
    control = ControlServer(manager)
    try:
        await control.start()
        await manager.restore_all()
        log.info("worker ready accounts=%s", manager.running_account_ids())
        await asyncio.Event().wait()
    finally:
        await control.close()
        await manager.close()
        await backend.close()


if __name__ == "__main__":
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        pass
