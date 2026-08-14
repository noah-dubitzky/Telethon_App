"""Compatibility entry point. PM2 may continue launching main.py."""
from telegram_worker import run
import asyncio

if __name__ == "__main__":
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        pass
