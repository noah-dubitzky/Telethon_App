import asyncio
import hmac
import os

import aiohttp
from aiohttp import web


class BackendClient:
    def __init__(self):
        self.base_url = os.getenv("NODE_INTERNAL_URL", "http://127.0.0.1:3000/internal/worker").rstrip("/")
        self.node_url = os.getenv("NODE_API_URL", "http://127.0.0.1:3000").rstrip("/")
        self.secret = os.getenv("TELESAVER_WORKER_SECRET", "")
        self.timeout = aiohttp.ClientTimeout(total=float(os.getenv("WORKER_HTTP_TIMEOUT_SECONDS", "10")))
        self.session = None

    async def open(self):
        if len(self.secret) < 32:
            raise RuntimeError("TELESAVER_WORKER_SECRET must be at least 32 characters")
        self.session = aiohttp.ClientSession(timeout=self.timeout, headers={"x-telesaver-worker-secret": self.secret})

    async def close(self):
        if self.session:
            await self.session.close()

    async def _request(self, method, path, payload=None):
        async with self.session.request(method, f"{self.base_url}{path}", json=payload) as response:
            response.raise_for_status()
            return await response.json() if response.content_type == "application/json" else None

    async def eligible_accounts(self):
        return (await self._request("GET", "/accounts"))["accounts"]

    async def account(self, account_id):
        return (await self._request("GET", f"/accounts/{account_id}"))["account"]

    async def set_status(self, account_id, status):
        return await self._request("PATCH", f"/accounts/{account_id}/status", {"status": status})

    async def filter_allowed(self, payload):
        return bool((await self._request("POST", "/filters/check", payload)).get("allowed", True))

    async def ingest(self, payload):
        async with self.session.post(f"{self.node_url}/messages", json=payload) as response:
            response.raise_for_status()
            return await response.json() if response.content_type == "application/json" else None


class ControlServer:
    def __init__(self, manager):
        self.manager = manager
        self.secret = os.getenv("TELESAVER_WORKER_SECRET", "")
        self.runner = None

    @web.middleware
    async def authenticate(self, request, handler):
        supplied = request.headers.get("x-telesaver-worker-secret", "")
        if not hmac.compare_digest(supplied, self.secret):
            raise web.HTTPUnauthorized()
        return await handler(request)

    async def start_account(self, request):
        account_id = int(request.match_info["account_id"])
        started = await self.manager.start_account(account_id)
        return web.json_response({"account_id": account_id, "running": True, "started": started})

    async def stop_account(self, request):
        account_id = int(request.match_info["account_id"])
        stopped = await self.manager.stop_account(account_id)
        return web.json_response({"account_id": account_id, "running": False, "stopped": stopped})

    async def restart_account(self, request):
        account_id = int(request.match_info["account_id"])
        await self.manager.restart_account(account_id)
        return web.json_response({"account_id": account_id, "running": True})

    async def health(self, _request):
        return web.json_response({"running_account_ids": self.manager.running_account_ids()})

    async def start(self):
        app = web.Application(middlewares=[self.authenticate])
        app.add_routes([
            web.post("/accounts/{account_id:\\d+}/start", self.start_account),
            web.post("/accounts/{account_id:\\d+}/stop", self.stop_account),
            web.post("/accounts/{account_id:\\d+}/restart", self.restart_account),
            web.get("/health", self.health),
        ])
        self.runner = web.AppRunner(app)
        await self.runner.setup()
        host = os.getenv("TELEGRAM_WORKER_HOST", "127.0.0.1")
        if host not in ("127.0.0.1", "::1", "localhost"):
            raise RuntimeError("Telegram worker control server must bind to localhost")
        await web.TCPSite(self.runner, host, int(os.getenv("TELEGRAM_WORKER_PORT", "8766"))).start()

    async def close(self):
        if self.runner:
            await self.runner.cleanup()
