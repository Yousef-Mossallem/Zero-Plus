# app/persistence/redis_client.py
# ============================================================
# Zero Plus — AI Service
# Redis client — cache, session history, temporary state
# Safe, typed, production-ready wrapper
# ============================================================

from __future__ import annotations

import json
import logging
from contextlib import contextmanager
from typing import Any, Dict, Generator, List, Optional, Union

from numpy import exp
import redis
from redis.exceptions import RedisError

from app.config import Settings, get_settings

logger = logging.getLogger("zero-plus-ai.redis")

# Type alias for values we store
RedisValue = Union[str, bytes, int, float]


class RedisClient:
    """
    Thin, safe wrapper around redis-py.

    Design goals:
    - Never crash the AI service if Redis is down (return None / False)
    - Simple API used by session_tracker + /analyze cache
    - JSON helpers for dict/list payloads
    - Explicit TTLs everywhere
    """

    def __init__(self, settings: Optional[Settings] = None) -> None:
        self.settings = settings or get_settings()
        self._client: Optional[redis.Redis] = None
        self._connected: bool = False

    # ------------------------------------------------------------------
    # Connection lifecycle
    # ------------------------------------------------------------------

    def connect(self) -> bool:
        """
        Create the underlying connection.
        Returns True on success, False on failure (service stays up).
        """
        if self._client is not None and self._connected:
            return True

        try:
            self._client = redis.Redis(
                host=self.settings.redis_host,
                port=self.settings.redis_port,
                db=self.settings.redis_db,
                password=self.settings.redis_password or None,
                ssl=self.settings.redis_ssl,
                decode_responses=True,          # we always work with str
                socket_connect_timeout=2.0,
                socket_timeout=2.0,
                retry_on_timeout=True,
                health_check_interval=30,
            )
            # Force a round-trip to verify
            self._client.ping()
            self._connected = True
            logger.info(
                "Redis connected (%s:%s/%s)",
                self.settings.redis_host,
                self.settings.redis_port,
                self.settings.redis_db,
            )
            return True
        except RedisError as exc:
            logger.warning("Redis connection failed: %s", exc)
            self._client = None
            self._connected = False
            return False
        except Exception as exc:
            logger.warning("Unexpected Redis error on connect: %s", exc)
            self._client = None
            self._connected = False
            return False

    def close(self) -> None:
        """Close the connection cleanly."""
        if self._client is not None:
            try:
                self._client.close()
            except Exception:
                pass
        self._client = None
        self._connected = False
        logger.info("Redis connection closed")

    @property
    def available(self) -> bool:
        """Quick check without raising."""
        if not self._connected or self._client is None:
            return False
        try:
            self._client.ping()
            return True
        except Exception:
            self._connected = False
            return False

    def _ensure(self) -> Optional[redis.Redis]:
        """Return client or None (never raises)."""
        if self._client is None or not self._connected:
            self.connect()
        return self._client if self._connected else None

    # ------------------------------------------------------------------
    # Basic key/value
    # ------------------------------------------------------------------

    def get(self, key: str) -> Optional[str]:
        client = self._ensure()
        if client is None:
            return None
        try:
            return client.get(key)
        except RedisError as exc:
            logger.warning("Redis GET %s failed: %s", key, exc)
            return None

    def set(
        self,
        key: str,
        value: RedisValue,
        *,
        ttl_sec: Optional[int] = None,
        nx: bool = False,
        xx: bool = False,
    ) -> bool:
        """
        Set a value.
        ttl_sec: expire after N seconds (None = no expiry)
        nx: only set if key does NOT exist
        xx: only set if key already exists
        """
        client = self._ensure()
        if client is None:
            return False
        try:
            result = client.set(
                key,
                value,
                ex=ttl_sec,
                nx=nx if nx else None,
                xx=xx if xx else None,
            )
            return bool(result)
        except RedisError as exc:
            logger.warning("Redis SET %s failed: %s", key, exc)
            return False

    def delete(self, *keys: str) -> int:
        """Delete one or more keys. Returns number of keys removed."""
        if not keys:
            return 0
        client = self._ensure()
        if client is None:
            return 0
        try:
            return int(client.delete(*keys))
        except RedisError as exc:
            logger.warning("Redis DELETE failed: %s", exc)
            return 0

    def exists(self, key: str) -> bool:
        client = self._ensure()
        if client is None:
            return False
        try:
            return bool(client.exists(key))
        except RedisError as exc:
            logger.warning("Redis EXISTS %s failed: %s", key, exc)
            return False

    def expire(self, key: str, ttl_sec: int) -> bool:
        client = self._ensure()
        if client is None:
            return False
        try:
            return bool(client.expire(key, ttl_sec))
        except RedisError as exc:
            logger.warning("Redis EXPIRE %s failed: %s", key, exc)
            return False

    def ttl(self, key: str) -> int:
        """
        Remaining TTL in seconds.
        -2 = key does not exist
        -1 = no expiry
         0+ = seconds left
        On error returns -2.
        """
        client = self._ensure()
        if client is None:
            return -2
        try:
            return int(client.ttl(key))
        except RedisError as exc:
            logger.warning("Redis TTL %s failed: %s", key, exc)
            return -2

    def incr(self, key: str, amount: int = 1) -> Optional[int]:
        client = self._ensure()
        if client is None:
            return None
        try:
            return int(client.incrby(key, amount))
        except RedisError as exc:
            logger.warning("Redis INCR %s failed: %s", key, exc)
            return None

    # ------------------------------------------------------------------
    # JSON helpers (dict / list)
    # ------------------------------------------------------------------

    def get_json(self, key: str) -> Optional[Any]:
        raw = self.get(key)
        if raw is None:
            return None
        try:
            return json.loads(raw)
        except (json.JSONDecodeError, TypeError) as exc:
            logger.warning("Redis GET_JSON %s decode failed: %s", key, exc)
            return None

    def set_json(
        self,
        key: str,
        value: Any,
        *,
        ttl_sec: Optional[int] = None,
    ) -> bool:
        try:
            payload = json.dumps(value, default=str, ensure_ascii=False)
        except (TypeError, ValueError) as exc:
            logger.warning("Redis SET_JSON %s encode failed: %s", key, exc)
            return False
        return self.set(key, payload, ttl_sec=ttl_sec)

    # ------------------------------------------------------------------
    # List helpers (used later for session history)
    # ------------------------------------------------------------------

    def list_rpush(self, key: str, *values: str) -> Optional[int]:
        """Append to the right (end) of a list."""
        client = self._ensure()
        if client is None:
            return None
        try:
            return int(client.rpush(key, *values))
        except RedisError as exc:
            logger.warning("Redis RPUSH %s failed: %s", key, exc)
            return None

    def list_lrange(self, key: str, start: int = 0, end: int = -1) -> List[str]:
        """Read a slice of a list. end=-1 means to the last element."""
        client = self._ensure()
        if client is None:
            return []
        try:
            return list(client.lrange(key, start, end))
        except RedisError as exc:
            logger.warning("Redis LRANGE %s failed: %s", key, exc)
            return []

    def list_llen(self, key: str) -> int:
        client = self._ensure()
        if client is None:
            return 0
        try:
            return int(client.llen(key))
        except RedisError as exc:
            logger.warning("Redis LLEN %s failed: %s", key, exc)
            return 0

    def list_ltrim(self, key: str, start: int, end: int) -> bool:
        """Keep only the specified range (useful to cap history size)."""
        client = self._ensure()
        if client is None:
            return False
        try:
            client.ltrim(key, start, end)
            return True
        except RedisError as exc:
            logger.warning("Redis LTRIM %s failed: %s", key, exc)
            return False

    def list_push_cap(
        self,
        key: str,
        value: str,
        *,
        max_len: int,
        ttl_sec: Optional[int] = None,
    ) -> bool:
        """
        Append a value and keep only the last max_len items.
        Also refreshes TTL if provided.
        """
        client = self._ensure()
        if client is None:
            return False
        try:
            pipe = client.pipeline()
            pipe.rpush(key, value)
            pipe.ltrim(key, -max_len, -1)
            if ttl_sec is not None:
                pipe.expire(key, ttl_sec)
            pipe.execute()
            return True
        except RedisError as exc:
            logger.warning("Redis list_push_cap %s failed: %s", key, exc)
            return False

    # ------------------------------------------------------------------
    # Hash helpers (optional, useful later)
    # ------------------------------------------------------------------

    def hget(self, key: str, field: str) -> Optional[str]:
        client = self._ensure()
        if client is None:
            return None
        try:
            return client.hget(key, field)
        except RedisError as exc:
            logger.warning("Redis HGET %s %s failed: %s", key, field, exc)
            return None

    def hset(self, key: str, field: str, value: RedisValue) -> bool:
        client = self._ensure()
        if client is None:
            return False
        try:
            client.hset(key, field, value)
            return True
        except RedisError as exc:
            logger.warning("Redis HSET %s %s failed: %s", key, field, exc)
            return False

    def hgetall(self, key: str) -> Dict[str, str]:
        client = self._ensure()
        if client is None:
            return {}
        try:
            return dict(client.hgetall(key))
        except RedisError as exc:
            logger.warning("Redis HGETALL %s failed: %s", key, exp)
            return {}

    # ------------------------------------------------------------------
    # Health / diagnostics
    # ------------------------------------------------------------------

    def ping(self) -> bool:
        return self.available

    def info_summary(self) -> Dict[str, Any]:
        """Small diagnostic dict (never raises)."""
        client = self._ensure()
        if client is None:
            return {"connected": False}
        try:
            info = client.info(section="server")
            return {
                "connected": True,
                "redis_version": info.get("redis_version"),
                "uptime_seconds": info.get("uptime_in_seconds"),
            }
        except Exception as exc:
            return {"connected": False, "error": str(exc)}


# =============================================================================
# Module-level singleton (used across the app)
# =============================================================================

_redis_singleton: Optional[RedisClient] = None


def get_redis() -> RedisClient:
    """
    Return the shared RedisClient instance.
    Call connect() during app startup (in lifespan).
    """
    global _redis_singleton
    if _redis_singleton is None:
        _redis_singleton = RedisClient()
    return _redis_singleton


def init_redis(settings: Optional[Settings] = None) -> RedisClient:
    """
    Explicit init (preferred in lifespan).
    Creates singleton, tries to connect, returns the client.
    """
    global _redis_singleton
    _redis_singleton = RedisClient(settings=settings)
    _redis_singleton.connect()
    return _redis_singleton


def close_redis() -> None:
    """Clean shutdown."""
    global _redis_singleton
    if _redis_singleton is not None:
        _redis_singleton.close()
        _redis_singleton = None


@contextmanager
def redis_connection(settings: Optional[Settings] = None) -> Generator[RedisClient, None, None]:
    """
    Context manager for scripts / tests:
        with redis_connection() as r:
            r.set("k", "v", ttl_sec=10)
    """
    client = RedisClient(settings=settings)
    client.connect()
    try:
        yield client
    finally:
        client.close()


__all__ = [
    "RedisClient",
    "get_redis",
    "init_redis",
    "close_redis",
    "redis_connection",
]