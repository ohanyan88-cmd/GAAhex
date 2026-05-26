"""Pure unit coverage for app.resolvers.account_or_customer (doc 17a dual-read rule).

The one documented rule: `account_id` if set, else `customer_id`, else nothing. No DB, no fixtures —
just tiny stub rows exposing the two attributes (a stand-in for Subscription/Invoice/Order/Service).
"""

from types import SimpleNamespace

from app.resolvers import account_or_customer


def test_prefers_account_when_account_id_set():
    row = SimpleNamespace(account_id="acc-1", customer_id="cust-1")
    assert account_or_customer(row) == ("account", "acc-1")


def test_falls_back_to_customer_when_no_account():
    row = SimpleNamespace(account_id=None, customer_id="cust-1")
    assert account_or_customer(row) == ("customer", "cust-1")


def test_none_none_when_neither_set():
    row = SimpleNamespace(account_id=None, customer_id=None)
    assert account_or_customer(row) == (None, None)


def test_none_none_when_attributes_missing_entirely():
    # a row that exposes neither attribute resolves to (None, None) via getattr defaults
    assert account_or_customer(SimpleNamespace()) == (None, None)
