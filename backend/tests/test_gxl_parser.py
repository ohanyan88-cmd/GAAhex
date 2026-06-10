"""GXL parser pre-scan — the negative half of the sealed GXL Extension addendum (§5 GXL-F1..F5).

Pure unit tests over ``gxl.validate_guard`` — no DB, no API. They lock in that every forbidden
pattern is rejected at parse time (HARD, never a runtime fall-through) and that single-hop ref keys
are extracted correctly for the resolver.
"""
import pytest

from app import gxl


# ── compatibility: local-field guards have no cross-record reach ──────────────

@pytest.mark.parametrize("expr", [
    None, "", "   ",
    "phone != None and phone != ''",
    "email != None and email != ''",
    "status == 'ACTIVE'",
    "priority > 3 and status != 'CLOSED'",
])
def test_local_field_guards_have_no_refs(expr):
    assert gxl.validate_guard(expr) == set()


# ── single-hop ref extraction (the resolver's input) ──────────────────────────

def test_single_hop_ref_extracted():
    assert gxl.validate_guard("account.balance_due == 0") == {"account"}


def test_multiple_fields_on_same_ref_collapse_to_one_key():
    # Two fields on the SAME linked record → one ref key → one pre-fetch (GXL-I2).
    assert gxl.validate_guard(
        "account.balance_due == 0 and account.status == 'ACTIVE'"
    ) == {"account"}


def test_two_distinct_refs_extracted():
    assert gxl.validate_guard("account.balance_due == 0 and sla.met_at != None") == {"account", "sla"}


# ── GXL-F2 — multi-hop refs rejected ──────────────────────────────────────────

@pytest.mark.parametrize("expr", [
    "account.holder.name == 'x'",
    "a.b.c.d == 1",
    "customer_account.holder.email != None",
])
def test_multi_hop_rejected(expr):
    with pytest.raises(gxl.GXLError):
        gxl.validate_guard(expr)


# ── GXL-F1 — aggregates rejected ──────────────────────────────────────────────

@pytest.mark.parametrize("expr", [
    "count(services) > 5", "sum(invoices) == 0", "any(tickets)",
    "all(x)", "len(services) > 0",
])
def test_aggregates_rejected(expr):
    with pytest.raises(gxl.GXLError):
        gxl.validate_guard(expr)


# ── GXL-F3 / F5 — side-effect / external function calls rejected ──────────────

@pytest.mark.parametrize("expr", [
    "now() > 0", "random() < 1", "uuid() != None",
    "http_get('x') == 200", "redis_get('k') != None",
])
def test_function_calls_rejected(expr):
    with pytest.raises(gxl.GXLError):
        gxl.validate_guard(expr)


# ── malformed expressions are a clear GXLError, never a raw SyntaxError ────────

@pytest.mark.parametrize("expr", ["account.balance_due ==", "and or", "=="])
def test_syntax_error_becomes_gxlerror(expr):
    with pytest.raises(gxl.GXLError):
        gxl.validate_guard(expr)
