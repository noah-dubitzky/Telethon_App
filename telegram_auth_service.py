"""Local-only Telethon authentication service for Telesaver Step 4."""

import asyncio
import hmac
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from telethon import TelegramClient
from telethon.errors import (
    FloodWaitError,
    PasswordHashInvalidError,
    PhoneCodeExpiredError,
    PhoneCodeInvalidError,
    PhoneNumberInvalidError,
    SessionPasswordNeededError,
)
from telethon.sessions import StringSession


def _settings():
    api_id = os.getenv("TELEGRAM_API_ID", "")
    api_hash = os.getenv("TELEGRAM_API_HASH", "")
    internal_secret = os.getenv("TELEGRAM_AUTH_INTERNAL_SECRET", "")
    if not api_id.isdigit() or not api_hash or len(internal_secret) < 32:
        raise RuntimeError(
            "TELEGRAM_API_ID, TELEGRAM_API_HASH, and a 32+ character "
            "TELEGRAM_AUTH_INTERNAL_SECRET are required"
        )
    return int(api_id), api_hash, internal_secret


def _identity(user):
    display_name = " ".join(
        part for part in (getattr(user, "first_name", None), getattr(user, "last_name", None)) if part
    )
    return {
        "id": str(user.id),
        "username": getattr(user, "username", None),
        "display_name": display_name or getattr(user, "username", None) or f"Telegram {user.id}",
    }


async def _start_login(payload, api_id, api_hash):
    phone = str(payload.get("phone_number") or "")
    client = TelegramClient(StringSession(), api_id, api_hash)
    await client.connect()
    try:
        sent = await client.send_code_request(phone)
        return {
            "status": "code_sent",
            "phone_code_hash": sent.phone_code_hash,
            "temporary_session": client.session.save(),
        }
    finally:
        await client.disconnect()


async def _verify_code(payload, api_id, api_hash):
    client = TelegramClient(StringSession(str(payload.get("temporary_session") or "")), api_id, api_hash)
    await client.connect()
    try:
        try:
            await client.sign_in(
                phone=str(payload.get("phone_number") or ""),
                code=str(payload.get("code") or ""),
                phone_code_hash=str(payload.get("phone_code_hash") or ""),
            )
        except SessionPasswordNeededError:
            return {"status": "password_required", "temporary_session": client.session.save()}
        user = await client.get_me()
        if not user:
            raise RuntimeError("Telegram did not return an authorized identity")
        return {"status": "connected", "session": client.session.save(), "identity": _identity(user)}
    finally:
        await client.disconnect()


async def _verify_password(payload, api_id, api_hash):
    client = TelegramClient(StringSession(str(payload.get("temporary_session") or "")), api_id, api_hash)
    await client.connect()
    try:
        await client.sign_in(password=str(payload.get("password") or ""))
        user = await client.get_me()
        if not user:
            raise RuntimeError("Telegram did not return an authorized identity")
        return {"status": "connected", "session": client.session.save(), "identity": _identity(user)}
    finally:
        await client.disconnect()


def _safe_exception(error):
    if isinstance(error, PhoneNumberInvalidError):
        return 400, {"error": "PHONE_INVALID"}
    if isinstance(error, PhoneCodeInvalidError):
        return 400, {"error": "PHONE_CODE_INVALID"}
    if isinstance(error, PhoneCodeExpiredError):
        return 410, {"error": "PHONE_CODE_EXPIRED"}
    if isinstance(error, PasswordHashInvalidError):
        return 400, {"error": "PASSWORD_INVALID"}
    if isinstance(error, SessionPasswordNeededError):
        return 409, {"error": "PASSWORD_REQUIRED"}
    if isinstance(error, FloodWaitError):
        return 429, {"error": "FLOOD_WAIT", "retry_after": max(1, int(error.seconds))}
    return 502, {"error": "TELEGRAM_AUTH_FAILED"}


class TelegramAuthHandler(BaseHTTPRequestHandler):
    server_version = "TelesaverTelegramAuth/1"

    def log_message(self, _format, *_args):
        # Avoid the standard request logger; request bodies contain secrets.
        return

    def _respond(self, status, payload):
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        try:
            api_id, api_hash, expected_secret = _settings()
            supplied_secret = self.headers.get("x-telesaver-internal-secret", "")
            if not hmac.compare_digest(supplied_secret, expected_secret):
                self._respond(401, {"error": "UNAUTHORIZED"})
                return
            length = int(self.headers.get("content-length", "0"))
            if length <= 0 or length > 64 * 1024:
                self._respond(400, {"error": "INVALID_REQUEST"})
                return
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            actions = {
                "/start": _start_login,
                "/verify-code": _verify_code,
                "/verify-password": _verify_password,
            }
            action = actions.get(self.path)
            if not action:
                self._respond(404, {"error": "NOT_FOUND"})
                return
            result = asyncio.run(action(payload, api_id, api_hash))
            self._respond(200, result)
        except (ValueError, json.JSONDecodeError):
            self._respond(400, {"error": "INVALID_REQUEST"})
        except Exception as error:  # Telethon errors are sanitized here.
            status, payload = _safe_exception(error)
            self._respond(status, payload)


def main():
    _settings()
    host = os.getenv("TELEGRAM_AUTH_HOST", "127.0.0.1")
    port = int(os.getenv("TELEGRAM_AUTH_PORT", "8765"))
    if host not in ("127.0.0.1", "::1", "localhost"):
        raise RuntimeError("Telegram auth service must bind to localhost")
    server = ThreadingHTTPServer((host, port), TelegramAuthHandler)
    print(f"Telegram auth service listening on {host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
