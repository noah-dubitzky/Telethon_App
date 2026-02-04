import os
import time
import requests

API_HOST = os.getenv("API_HOST", "localhost")
API_PORT = os.getenv("API_PORT", "3000")

FILTER_CHECK_URL = os.getenv("FILTER_CHECK_URL", f"http://{API_HOST}:{API_PORT}/filters/check")
FILTER_TIMEOUT_SECONDS = float(os.getenv("FILTER_TIMEOUT_SECONDS", "2"))
FILTER_CACHE_TTL_SECONDS = int(os.getenv("FILTER_CACHE_TTL_SECONDS", "60"))

# cache: key -> (allowed, expires_epoch)
_cache = {}


def _cache_get(key: str):
    item = _cache.get(key)
    if not item:
        return None
    allowed, expires = item
    if time.time() > expires:
        _cache.pop(key, None)
        return None
    return allowed


def _cache_set(key: str, allowed: bool):
    _cache[key] = (allowed, time.time() + FILTER_CACHE_TTL_SECONDS)


def should_save_message(external_sender_id, sender_name, channel_key) -> bool:
    """
    Ask the backend if this message should be saved.
    FAIL-OPEN: if backend is unreachable or errors, return True to avoid losing data.
    """
    sender_str = str(external_sender_id) if external_sender_id is not None else ""
    sender_name_str = str(sender_name) if sender_name is not None else ""
    channel_str = str(channel_key) if channel_key is not None else ""

    cache_key = f"s:{sender_str}sn:{sender_name_str}|c:{channel_str}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    try:
        r = requests.post(
            FILTER_CHECK_URL,
            json={
                "external_sender_id": sender_str if sender_str else None,
                "sender_name": sender_name_str if sender_name_str else None,
                "channel_key": channel_str if channel_str else None
            },
            timeout=FILTER_TIMEOUT_SECONDS
        )
        r.raise_for_status()
        allowed = bool(r.json().get("allowed", True))
        _cache_set(cache_key, allowed)
        return allowed
    except Exception as e:
        print("[filter] check failed (fail-open):", e)
        return True
