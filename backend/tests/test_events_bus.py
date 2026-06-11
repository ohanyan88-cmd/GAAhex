"""Direct unit tests for the domain-event bus (app/kernel/events.py) — PERFECT-TARGET I3.

The ``order.activated`` choreography (CRM creates the customer, Care files the welcome check-call,
Billing provisions subscriptions) rides entirely on this bus, yet the bus itself had ZERO direct
coverage — it was exercised only transitively through the order-activation end-state assertions in
test_loop_e2e.py. That made the bus contract (registration ORDER, idempotent re-registration, the
``{handler_name: result}`` shape the caller reads ``billing.provision`` back from) invisible to CI.

These tests pin that contract directly, before the cutover starts relying on the bus from a
config-declared ``publish`` action (cutover step 3). The bus passes the session straight through to
handlers and does no DB work itself, so these are pure (no DB fixture needed) — they use unique test
event names and clean up the global registry so they never touch the real order.activated subscribers.
"""
from app.kernel import events


async def test_publish_runs_handlers_in_registration_order_and_keys_results():
    calls: list[str] = []

    async def first(s, **ctx):
        calls.append("first")
        return "r1"

    async def second(s, **ctx):
        calls.append("second")
        return {"provisioned": ctx.get("n")}

    events.subscribe("test.ev.order", "crm.first", first)
    events.subscribe("test.ev.order", "billing.second", second)
    try:
        result = await events.publish(None, "test.ev.order", n=3)
        # registration order is preserved (a later handler may depend on an earlier one's writes)
        assert calls == ["first", "second"]
        # results are keyed by handler name so a caller can read a specific reaction back
        assert result == {"crm.first": "r1", "billing.second": {"provisioned": 3}}
    finally:
        events._SUBSCRIBERS.pop("test.ev.order", None)


async def test_subscribe_is_idempotent_on_handler_name():
    async def old(s, **ctx):
        return "old"

    async def new(s, **ctx):
        return "new"

    events.subscribe("test.ev.idem", "h", old)
    events.subscribe("test.ev.idem", "h", new)  # same (event, name) → replace, never double-register
    try:
        assert len(events._SUBSCRIBERS["test.ev.idem"]) == 1
        result = await events.publish(None, "test.ev.idem")
        assert result == {"h": "new"}
    finally:
        events._SUBSCRIBERS.pop("test.ev.idem", None)


async def test_publish_with_no_subscribers_is_a_noop():
    # an event nobody listens to returns an empty result dict, never raises
    assert await events.publish(None, "test.ev.unheard") == {}


async def test_context_is_forwarded_to_every_handler():
    seen: list[dict] = []

    async def capture(s, **ctx):
        seen.append(ctx)
        return None

    events.subscribe("test.ev.ctx", "capture", capture)
    try:
        sentinel = object()
        await events.publish(None, "test.ev.ctx", record=sentinel, tenant_id="t1", actor_user_id="u1")
        assert len(seen) == 1
        assert seen[0]["record"] is sentinel
        assert seen[0]["tenant_id"] == "t1"
        assert seen[0]["actor_user_id"] == "u1"
    finally:
        events._SUBSCRIBERS.pop("test.ev.ctx", None)
