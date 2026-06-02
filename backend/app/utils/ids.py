"""UUIDv7 id generation — the canonical default_factory for every primary id and
every UUID FK default on this platform (Standard 8 — ID).

UUIDv7 is time-ordered (first 48 bits are unix-ms timestamp), distributed-safe,
and lives in the same Postgres `uuid` column type as uuid4 — legacy uuid4 ids
stay valid. We generate app-side because PG 16 has no native uuidv7() function
(landed in PG 18).
"""
from __future__ import annotations
import uuid as _uuid
from uuid_utils import uuid7 as _uuid7


def uuid7() -> _uuid.UUID:
    """Return a fresh UUIDv7 as a stdlib UUID (so SQLAlchemy/Pydantic accept it
    without adaptation). uuid_utils.uuid7() returns its own UUID subclass; we
    coerce to stdlib UUID for maximum compatibility."""
    return _uuid.UUID(str(_uuid7()))
