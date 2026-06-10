"""GXL compatibility window — evaluation semantics (sealed addendum §7).

The extension is purely additive: local-field guards must evaluate to exactly the same result
after it as before. These cases pin the representative pre-extension guards, and a final case
shows the NEW cross-record capability evaluating against an injected linked-record dict (the shape
``workflow.resolve_cross_record`` produces).
"""
import pytest

from app import gxl


# (guard, context, expected) — every guard here is a pre-extension local-field guard.
LOCAL_CASES = [
    ("phone != None and phone != ''", {"phone": "+37491000"}, True),
    ("phone != None and phone != ''", {"phone": None}, False),
    ("phone != None and phone != ''", {"phone": ""}, False),
    ("phone != None and phone != ''", {}, False),                  # missing name → None → fail
    ("email != None and email != ''", {"email": "a@b.io"}, True),
    ("email != None and email != ''", {"email": None}, False),
    ("status == 'ACTIVE'", {"status": "ACTIVE"}, True),
    ("status == 'ACTIVE'", {"status": "PENDING"}, False),
    (None, {}, True),                                              # no guard → always-pass
    ("", {}, True),
]


@pytest.mark.parametrize("expr,ctx,expected", LOCAL_CASES)
def test_local_field_guard_eval_unchanged(expr, ctx, expected):
    assert gxl.evaluate(expr, ctx) is expected


def test_cross_record_eval_against_injected_ref():
    """The new capability: with the linked record's data dict bound into the context (as the
    resolver does), one-hop attribute access evaluates correctly via simpleeval's index fallback."""
    ctx = {"account": {"balance_due": 0, "status": "ACTIVE"}, "status": "PENDING"}
    assert gxl.evaluate("account.balance_due == 0", ctx) is True
    assert gxl.evaluate("account.balance_due == 0 and account.status == 'ACTIVE'", ctx) is True

    arrears = {"account": {"balance_due": 100, "status": "ACTIVE"}, "status": "PENDING"}
    assert gxl.evaluate("account.balance_due == 0", arrears) is False


def test_cross_record_eval_absent_ref_fails_closed():
    """A resolved-to-None ref (missing / cross-tenant) makes the guard fail closed."""
    assert gxl.evaluate("account.balance_due == 0", {"account": None}) is False
