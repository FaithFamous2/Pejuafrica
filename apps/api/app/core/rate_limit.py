"""Rate limiting helpers (in-memory; swap to Redis in production scale)."""

from __future__ import annotations

import time
from collections import defaultdict, deque
from threading import Lock

from fastapi import HTTPException, Request, status

_lock = Lock()
_buckets: dict[str, deque[float]] = defaultdict(deque)


def _client_key(request: Request, scope: str) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    ip = forwarded.split(",")[0].strip() if forwarded else (
        request.client.host if request.client else "unknown"
    )
    return f"{scope}:{ip}"


def enforce_rate_limit(request: Request, *, scope: str, limit: int, window_seconds: int) -> None:
    key = _client_key(request, scope)
    now = time.monotonic()
    cutoff = now - window_seconds
    with _lock:
        q = _buckets[key]
        while q and q[0] < cutoff:
            q.popleft()
        if len(q) >= limit:
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Rate limit exceeded for {scope}. Try again shortly.",
            )
        q.append(now)
