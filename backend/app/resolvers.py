"""Cross-cutting resolution rules — one rule, one place (mirrors access._scope_ok).

doc 17a (Account/Party, Stage 1): the four BSS tables (Subscription/Invoice/Order/Service) gained
an OPTIONAL nullable `account_id` beside their untouched `customer_id`. Everything that needs to
know "who owns this row" MUST resolve through here, never inline, so the dual-read fallback lives
in exactly one place during the long additive migration."""


def account_or_customer(row):
    """The single documented rule (17a): **`account_id` if set, else `customer_id`.**

    Returns ("account", id) when the row carries an account_id, ("customer", id) when it falls back
    to the legacy customer_id, or (None, None) when neither is set. `row` is any object exposing
    `account_id` / `customer_id` (a Subscription/Invoice/Order/Service)."""
    account_id = getattr(row, "account_id", None)
    if account_id is not None:
        return "account", account_id
    customer_id = getattr(row, "customer_id", None)
    if customer_id is not None:
        return "customer", customer_id
    return None, None
