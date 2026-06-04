"""H7 Stage 2 — Configuration JSONB schema validation registry.

A Configuration row carries an arbitrary JSONB `configuration_value`. Without a per-key shape
check the router accepts ANY JSON for ANY key — a string where a boolean is expected, a typo
in a feature flag value, an integer overflow on a rate limit. The audit (H7) flagged the open
shape as a soft-correctness gap.

This module is the registry. A schema is a callable
    (value: Any) -> tuple[bool, str | None]
returning (is_valid, error_msg_or_None). The router calls `validate(config_key, value)` on
every create + update; an invalid value short-circuits to HTTP 422 with the error message;
an unknown key passes with a `CONFIG_SCHEMALESS_WRITE:<key>` warning so SuperAdmin can see
which keys still need a schema.

We INTENTIONALLY ship the registry empty — every real key needs the product owner's say on
what shape is canonical (a `feature.foo.enabled` may want strict bool but `feature.foo.value`
may want a number-or-string union, depending on intent). Add entries here as keys are locked.

Pattern for adding a new schema:

    def _is_strict_bool(v):
        return isinstance(v, bool), None if isinstance(v, bool) else f"Expected boolean, got {type(v).__name__}"

    CONFIG_SCHEMAS["feature.x.enabled"] = _is_strict_bool

Returning a `(False, msg)` from the schema flips the router to 422 with `detail=msg`.
"""
from __future__ import annotations

from typing import Any, Callable


# Public type alias for the validator signature — annotated callers can use this.
SchemaFn = Callable[[Any], tuple[bool, str | None]]


# ---- example schema helpers (NOT registered — left as reference) ──────────────────────────
# These are the canonical shapes future keys can reuse. Wiring them up is per-key, gated on
# product-owner sign-off.

def _is_strict_bool(v: Any) -> tuple[bool, str | None]:
    """True iff `v` is a real Python bool (rejects 0/1, "true"/"false", None)."""
    if isinstance(v, bool):
        return True, None
    return False, f"Expected boolean, got {type(v).__name__}"


def _is_positive_int(v: Any) -> tuple[bool, str | None]:
    """True iff `v` is an int > 0. Rejects bools (which `isinstance(True, int)` would pass)."""
    if isinstance(v, bool):
        return False, f"Expected integer, got bool"
    if not isinstance(v, int):
        return False, f"Expected integer, got {type(v).__name__}"
    if v <= 0:
        return False, f"Expected positive integer, got {v}"
    return True, None


def _is_nonempty_string(v: Any) -> tuple[bool, str | None]:
    """True iff `v` is a non-empty str."""
    if not isinstance(v, str):
        return False, f"Expected string, got {type(v).__name__}"
    if not v:
        return False, "Expected non-empty string"
    return True, None


# ---- registry ─────────────────────────────────────────────────────────────────────────────
# Keys map to validator callables. The router calls validate(key, value) on every write.
# Empty by default — to be filled per product-owner spec as configuration keys are locked.
# Tests can mutate this dict via `register_schema()` to exercise the 422 path without
# committing a schema choice to production.
CONFIG_SCHEMAS: dict[str, SchemaFn] = {
    # No schemas registered yet — to be filled per product owner spec.
}


def register_schema(config_key: str, schema: SchemaFn) -> None:
    """Register a validator for a configuration key. Idempotent — re-registering a key
    overwrites the previous entry (useful for tests). Production registration goes through
    explicit edits to CONFIG_SCHEMAS above; this helper exists primarily for test fixtures."""
    CONFIG_SCHEMAS[config_key] = schema


def unregister_schema(config_key: str) -> None:
    """Remove a validator; no-op if the key isn't registered. Test cleanup hook."""
    CONFIG_SCHEMAS.pop(config_key, None)


def validate(config_key: str, value: Any) -> tuple[bool, str | None]:
    """Returns (is_valid, error_or_None).

    Unknown key (no schema registered) → (True, None). The CALLER logs a
    `CONFIG_SCHEMALESS_WRITE:<key>` warning so SuperAdmin can see which keys still need a
    schema (the registry stays empty by default so we never block a write on the strict
    invariant — but we want the visibility).
    """
    schema = CONFIG_SCHEMAS.get(config_key)
    if schema is None:
        return True, None  # No schema registered → permit; caller logs the warning.
    return schema(value)
