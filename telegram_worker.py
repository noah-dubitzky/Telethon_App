"""One-process, multi-session Telethon ingestion worker."""
import asyncio
import logging
import mimetypes
import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from zoneinfo import ZoneInfo

try:
    import boto3
except ImportError:  # Gives a focused startup error when dependencies were not installed.
    boto3 = None
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
    user_id: int


class S3MediaStorage:
    CATEGORIES = {"images", "videos", "audio", "documents", "stickers", "voice", "other"}

    def __init__(self, s3_client=None):
        self.bucket = os.getenv("S3_BUCKET_NAME", "").strip()
        self.region = os.getenv("AWS_REGION", "").strip()
        if not self.bucket or not self.region:
            raise RuntimeError("S3_BUCKET_NAME and AWS_REGION are required")
        # Do not pass credentials explicitly: boto3's default chain supports both
        # local AWS_* variables and an EC2 instance-profile IAM role.
        if s3_client is None and boto3 is None:
            raise RuntimeError("boto3 is required; install requirements-step5.txt")
        self.client = s3_client or boto3.client("s3", region_name=self.region)

    @staticmethod
    def _document(event):
        return getattr(getattr(event, "media", None), "document", None)

    def describe(self, event):
        document = self._document(event)
        event_file = getattr(event, "file", None)
        mime_type = (getattr(document, "mime_type", None) or getattr(event_file, "mime_type", None) or "").lower()
        original = getattr(event_file, "name", None)
        is_sticker = bool(getattr(event, "sticker", None))
        is_voice = bool(getattr(event, "voice", None))
        if is_sticker:
            category = "stickers"
        elif is_voice:
            category = "voice"
        elif mime_type.startswith("image/") or getattr(event, "photo", None):
            category = "images"
        elif mime_type.startswith("video/") or getattr(event, "video", None):
            category = "videos"
        elif mime_type.startswith("audio/") or getattr(event, "audio", None):
            category = "audio"
        elif document:
            category = "documents"
        else:
            category = "other"
        extension = (Path(original or "").suffix or getattr(event_file, "ext", None)
                     or mimetypes.guess_extension(mime_type) or "")
        extension = re.sub(r"[^A-Za-z0-9.]", "", extension.lower())[:16]
        return category, mime_type or None, original, extension

    @staticmethod
    def _safe_name(value):
        value = Path(value or "").name
        stem, suffix = Path(value).stem, Path(value).suffix
        stem = re.sub(r"[^A-Za-z0-9._-]+", "_", stem).strip("._-")[:120] or "file"
        suffix = re.sub(r"[^A-Za-z0-9.]", "", suffix.lower())[:16]
        return f"{stem}{suffix}"

    def object_key(self, user_id, account_id, event, category, original, extension):
        chat_id = str(event.chat_id).replace("-", "neg")
        message_id = int(event.message.id)
        if original:
            safe = self._safe_name(original)
            filename = f"{chat_id}_{message_id}_{safe}"
        else:
            filename = f"{chat_id}_{message_id}{extension}"
        return f"users/{int(user_id)}/telegram_accounts/{int(account_id)}/{category}/{filename}"

    async def archive(self, user_id, account_id, event):
        category, mime_type, original, extension = self.describe(event)
        key = self.object_key(user_id, account_id, event, category, original, extension)
        temp_path = None
        uploaded = False
        try:
            suffix = extension or ".bin"
            with tempfile.NamedTemporaryFile(prefix="telesaver_", suffix=suffix, delete=False) as temp:
                temp_path = Path(temp.name)
            try:
                downloaded = await event.download_media(file=str(temp_path))
                if not downloaded or not temp_path.is_file():
                    raise RuntimeError("Telegram returned no downloaded media file")
            except Exception as error:
                log.error("telegram download failed user=%s account=%s message=%s media_type=%s type=%s",
                          user_id, account_id, event.message.id, category, type(error).__name__)
                return None
            try:
                upload_args = {"ContentType": mime_type} if mime_type else None
                await asyncio.to_thread(self.client.upload_file, str(temp_path), self.bucket, key, upload_args)
                uploaded = True
            except Exception as error:
                log.error("s3 upload failed user=%s account=%s message=%s media_type=%s s3_key=%s type=%s",
                          user_id, account_id, event.message.id, category, key, type(error).__name__)
                return None
            return {"s3_key": key, "original_filename": original[:255] if original else None,
                    "mime_type": mime_type[:255] if mime_type else None,
                    "file_size": temp_path.stat().st_size, "media_type": category, "_temp_path": str(temp_path)}
        finally:
            # Upload failures are logged before this executes. Successful uploads
            # are retained until the caller has attempted database persistence.
            if temp_path and temp_path.exists() and not uploaded:
                temp_path.unlink(missing_ok=True)

    @staticmethod
    def cleanup(media):
        if media and media.get("_temp_path"):
            Path(media["_temp_path"]).unlink(missing_ok=True)


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
        self.media_storage = S3MediaStorage()
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
                self.clients[account_id] = ActiveClient(client, account_id, int(account["user_id"]))
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
        active = self.clients.get(account_id)
        if not active:
            raise RuntimeError(f"No trusted active account context for account {account_id}")
        media = await self._download_media(active.user_id, account_id, event)
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
            "media": {k: v for k, v in media.items() if not k.startswith("_")} if media else None,
            "timestamp": event.date.astimezone(self.timezone).strftime("%Y-%m-%d %H:%M:%S"),
        }
        try:
            await self.backend.ingest(payload)
        except Exception as error:
            log.error("database save failed user=%s account=%s message=%s media_type=%s s3_key=%s type=%s",
                      active.user_id, account_id, payload["telegram_message_id"],
                      media.get("media_type") if media else None, media.get("s3_key") if media else None,
                      type(error).__name__)
            raise
        finally:
            self.media_storage.cleanup(media)
        log.info("account=%s message=%s archived", account_id, payload["telegram_message_id"])

    async def _download_media(self, user_id, account_id, event):
        if not event.media:
            return None
        return await self.media_storage.archive(user_id, account_id, event)


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
