"""M1-A audit item #4 — tenant-filter safety net (defense layer 2 after RLS).

A read-only SQLAlchemy engine event listener that scans every executed SQL statement
and emits a loud WARNING when it touches a tenant-scoped table without filtering by
`tenant_id`. Catches developer mistakes early:

  * In **dev** the `gaahex` superuser bypasses RLS, so a missing `tenant_id` filter
    silently leaks rows across tenants — this listener is the only thing that
    surfaces the bug.
  * In **prod** the `gaahex_app` role enforces RLS, so the same bug instead
    returns an empty result — also worth flagging, since it's invariably a
    mistake (the developer thought they were getting rows).

Design constraints honored:
  * **Never raises** — warning only, never breaks the app.
  * **Cheap** — compiled SQL is already a string; we do bounded substring scans
    against a frozenset of tenant-scoped table names, no re-parsing.
  * **Bypassable** — `execution_options(audit_tenant_filter=False)` skips the
    check for legitimate exceptions (seeding, GUC binding, owner-role reads,
    pre-auth lookups, etc.).
  * **Zero-overhead when off** — gated by `GAAHEX_TENANT_AUDIT`; if disabled
    the listener is never attached, so production runtime is untouched.
  * **No new deps** — SQLAlchemy + stdlib only.

The listener is a *safety net*, not a security boundary. Real tenant isolation
is enforced by Postgres RLS policies on the `gaahex_app` role. This file exists
purely to make developer mistakes loud during local dev.
"""
from __future__ import annotations

import logging
import os
import re
import traceback
from typing import Iterable

from sqlalchemy import event

from .models.base import Base


_log = logging.getLogger("gaahex.tenant_audit")


# ---- table discovery ----------------------------------------------------------------------------

def _discover_tenant_scoped_tables() -> frozenset[str]:
    """Walk `Base.metadata` once at import time and return the set of table names
    that carry a `tenant_id` column. These are the tables this listener guards."""
    names: set[str] = set()
    for table in Base.metadata.tables.values():
        if "tenant_id" in table.columns:
            names.add(table.name)
    return frozenset(names)


# Resolved lazily on first setup() call so that `app.models.__init__` has had a
# chance to populate `Base.metadata` (db.py is imported BEFORE the models in
# main.py's import chain). Re-snapshotted on each setup() — cheap, idempotent,
# and lets tests register a synthetic model and re-attach.
TENANT_SCOPED_TABLES: frozenset[str] = frozenset()


# ---- SQL inspection -----------------------------------------------------------------------------

# Identifier-boundary scan: tablename appears whole-word in the statement and
# `tenant_id` also appears whole-word. We deliberately use a substring/regex
# check on the compiled SQL string instead of walking the ClauseElement tree —
# this listener runs on EVERY query and the requirement is "string scan, cheap,
# safety-net". False positives are acceptable; the warning is informational.


def _tables_referenced(sql: str, candidates: frozenset[str]) -> list[str]:
    """Return the subset of `candidates` whose name appears as a whole word in `sql`.

    Two-stage filter: a cheap substring check first (skips ~all candidates per
    query), then a word-boundary regex only on substring hits to weed out
    spurious partials (e.g. ``order`` inside ``order_item``). The candidate set
    is stable per process, so total cost per query is small and bounded.
    """
    s = sql.lower()
    hits: list[str] = []
    for name in candidates:
        if name not in s:
            continue  # fast-path: no substring → can't be a match
        if re.search(rf"\b{re.escape(name)}\b", s):
            hits.append(name)
    return hits


def _mentions_tenant_id(sql: str) -> bool:
    """True iff the compiled SQL contains a `tenant_id` token (whole word).

    Deliberately broad: a reference anywhere in the statement (WHERE, ON, USING,
    a join clause, a subquery, etc.) counts. We only care that *some* tenant
    filter is present — pinpointing per-table tenancy would require parsing,
    which the spec explicitly rules out.
    """
    return re.search(r"\btenant_id\b", sql, re.IGNORECASE) is not None


# ---- caller-frame heuristic ---------------------------------------------------------------------

# Frames inside SQLAlchemy / asyncpg / this audit module aren't useful when
# reporting "where did the bad query come from". We walk the traceback and
# pick the first frame OUTSIDE these prefixes.
_INTERNAL_FRAME_HINTS = (
    "sqlalchemy",
    "asyncpg",
    "tenant_query_audit",
)


def _best_effort_caller() -> str:
    """Best-effort caller location for the warning message — never raises.

    Walks the current Python stack and returns the first frame outside
    SQLAlchemy / asyncpg / this module. Format: ``file.py:LINE in func``.
    Returns ``"<unknown>"`` on any failure (we never let diagnostics break the
    audit itself).
    """
    try:
        for frame in reversed(traceback.extract_stack()[:-1]):
            fname = (frame.filename or "").replace("\\", "/").lower()
            if any(hint in fname for hint in _INTERNAL_FRAME_HINTS):
                continue
            short = frame.filename.replace("\\", "/").rsplit("/", 2)
            short_path = "/".join(short[-2:]) if len(short) >= 2 else frame.filename
            return f"{short_path}:{frame.lineno} in {frame.name}"
    except Exception:
        pass
    return "<unknown>"


# ---- the listener -------------------------------------------------------------------------------

def _emit_warning(tables: Iterable[str], sql: str) -> None:
    """Log the violation. Single warning line so it's easy to grep for in dev logs."""
    table_list = ", ".join(sorted(tables))
    snippet = " ".join(sql.split())  # collapse whitespace for a readable one-liner
    if len(snippet) > 240:
        snippet = snippet[:237] + "..."
    _log.warning(
        "tenant_audit: query on tenant-scoped table(s) [%s] without tenant_id filter "
        "(caller=%s) — SQL: %s",
        table_list,
        _best_effort_caller(),
        snippet,
    )


def _before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
    """Engine-level `before_cursor_execute` hook.

    Runs after SQLAlchemy has compiled the statement to a real driver-level SQL
    string. We inspect that string for a tenant-scoped table reference and the
    presence of a `tenant_id` token; mismatch → warning. Never raises.
    """
    try:
        # Bypass via execution_options(audit_tenant_filter=False) — propagated
        # through `context.execution_options` for ORM/Core executions.
        if context is not None:
            opts = getattr(context, "execution_options", None) or {}
            if opts.get("audit_tenant_filter") is False:
                return

        # SQLAlchemy may hand us a CompiledSQL or a bare str depending on the
        # path. Normalize to str; if it's not stringifiable, just bail out.
        try:
            sql = str(statement) if statement is not None else ""
        except Exception:
            return
        if not sql:
            return

        # Skip the GUC-binding queries we emit ourselves (set_config(...)).
        # They're owner-role / RLS infrastructure, not tenant data reads.
        if "set_config" in sql.lower():
            return

        hits = _tables_referenced(sql, TENANT_SCOPED_TABLES)
        if not hits:
            return  # query doesn't touch any tenant-scoped table → not our concern

        if _mentions_tenant_id(sql):
            return  # has a tenant_id reference somewhere → assumed OK

        _emit_warning(hits, sql)
    except Exception:
        # Audit MUST NOT break queries. Swallow anything unexpected — a missed
        # warning is preferable to a 500.
        return


# ---- wiring -------------------------------------------------------------------------------------

# Track listeners we attach so re-running setup() in tests / reload scenarios
# doesn't double-fire. Keyed by sync-engine id.
_ATTACHED: set[int] = set()


def _audit_enabled() -> bool:
    """Read the env gate at call-time (not import-time) so tests can flip it.

    `GAAHEX_TENANT_AUDIT`:
      - explicit "on" / "1" / "true" / "yes" → enabled
      - explicit "off" / "0" / "false" / "no" → disabled
      - unset → enabled in dev, disabled under pytest / alembic / production

    Also disabled when running under alembic (owner role, no GUC, intentional)
    and when running under pytest (the audit MUST NOT require fixture changes;
    tests opt in explicitly by exporting GAAHEX_TENANT_AUDIT=on).
    """
    import sys

    raw = os.environ.get("GAAHEX_TENANT_AUDIT", "").strip().lower()
    if raw in ("off", "0", "false", "no", ""):
        # Explicit off — respect it. Empty (unset) → fall through to the
        # context-aware defaults below.
        if raw:
            return False

    # Alembic detection — env.py runs with sys.argv[0] containing "alembic".
    argv0 = (sys.argv[0] if sys.argv else "").lower()
    if "alembic" in argv0:
        return False

    # Pytest detection — the pytest module is loaded as soon as a pytest run
    # starts. We check sys.modules (cheap, no import) instead of an env var so
    # conftest doesn't need any changes.
    if raw == "" and "pytest" in sys.modules:
        return False

    # Production deploys set ENVIRONMENT=production via .env; tests + dev leave
    # it at "development". Imported lazily to avoid a circular import (config
    # is loaded eagerly elsewhere, but we don't want to depend on its import
    # order from this module).
    if raw == "":
        try:
            from .config import is_production
            if is_production():
                return False
        except Exception:
            pass

    # Explicit on, or unset in dev → enable.
    return raw in ("on", "1", "true", "yes") or raw == ""


def setup_tenant_query_audit(engine) -> bool:
    """Attach the audit listener to `engine` if enabled.

    Returns True if the listener was attached, False otherwise (disabled or
    already attached). Safe to call multiple times. Accepts both sync `Engine`
    and `AsyncEngine` — for the async case we attach to the underlying sync
    engine (`engine.sync_engine`).

    Re-snapshots `TENANT_SCOPED_TABLES` from `Base.metadata` on each call so
    that callers from later in the import chain (after models register) see
    the full set, not the empty snapshot from module-import time.
    """
    if not _audit_enabled():
        return False

    # Refresh the guarded-table set — models may have registered after this
    # module first loaded (db.py imports before models in main.py).
    global TENANT_SCOPED_TABLES
    TENANT_SCOPED_TABLES = _discover_tenant_scoped_tables()

    sync_engine = getattr(engine, "sync_engine", engine)
    key = id(sync_engine)
    if key in _ATTACHED:
        return False

    event.listen(sync_engine, "before_cursor_execute", _before_cursor_execute)
    _ATTACHED.add(key)
    _log.info(
        "tenant_audit: attached to engine (guarding %d tenant-scoped tables)",
        len(TENANT_SCOPED_TABLES),
    )
    return True
