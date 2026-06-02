"""HTTP middleware package — cross-cutting concerns mounted in app/main.py.

Currently houses:
  - IdempotencyMiddleware  (API Standard file 12 / standard 66) — replays the
    cached response for repeated POST/PATCH/DELETE requests that share an
    Idempotency-Key header within the 24h retention window.
"""
from .idempotency import IdempotencyMiddleware

__all__ = ["IdempotencyMiddleware"]
