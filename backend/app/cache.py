import json
import time
from redis.asyncio import Redis


class RedisCache:
    def __init__(self, url):
        self.redis = Redis.from_url(url, decode_responses=True, socket_connect_timeout=3, socket_timeout=3)

    async def get(self, key):
        raw = await self.redis.get('meridian:v5:' + key)
        return json.loads(raw) if raw else None

    async def set(self, key, value, ttl=86400):
        await self.redis.set('meridian:v5:' + key, json.dumps(value, ensure_ascii=False, allow_nan=False), ex=ttl)

    async def health(self):
        return bool(await self.redis.ping())

    async def close(self):
        await self.redis.aclose()


class MemoryCache:
    """Explicit test double, never selected by production configuration."""
    def __init__(self):
        self.data = {}

    async def get(self, key):
        row = self.data.get(key)
        return row[0] if row and row[1] > time.monotonic() else None

    async def set(self, key, value, ttl=86400):
        self.data[key] = (value, time.monotonic() + ttl)

    async def health(self):
        return True

    async def close(self):
        pass

