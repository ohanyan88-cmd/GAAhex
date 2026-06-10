"""GXL compatibility window — corpus parse (sealed addendum §7).

Promise: every GXL guard that exists today parses byte-for-byte unchanged after the extension.
This test loads every guard string from every ``WorkflowDef`` in the seeded test DB and asserts
each one passes ``gxl.validate_guard`` without raising. A guard that now fails to parse is a
compatibility regression, not a test bug.

Reads via ``OwnerSessionLocal`` (RLS-bypassing owner role) so the corpus is the FULL set of guards
across all tenants regardless of which CI job runs it — the ``backend-rls`` job's ``gaahex_app``
role would otherwise see zero rows without a tenant GUC bound.
"""
from sqlalchemy import select

from app import gxl
from app.db import OwnerSessionLocal
from app.models import WorkflowDef


async def _all_guards() -> list[str]:
    async with OwnerSessionLocal() as s:
        defs = (await s.execute(select(WorkflowDef))).scalars().all()
    guards: list[str] = []
    for d in defs:
        for t in (d.config or {}).get("transitions", []):
            g = t.get("guard")
            if g:
                guards.append(g)
    return guards


async def test_existing_guard_corpus_parses_clean():
    guards = await _all_guards()
    # The seeds ship at least the lead phone-guard and the customer email-guard.
    assert guards, "expected the seeded lead/customer guards to be present in the corpus"
    for g in guards:
        # Must not raise — every pre-extension guard stays valid under the new grammar.
        gxl.validate_guard(g)


async def test_seeded_guards_have_no_cross_record_reach():
    """The PRE-EXTENSION seeded guards (the demo `lead` + `customer` lifecycles) are local-field only
    (no dot). Anchors the §9 rollback claim that reverting the extension leaves every existing guard
    working. Scoped to those two seeded entities so it's robust against test-created entities that
    legitimately DO use cross-record reach (e.g. KT-GXL-1's service guard)."""
    from app.models import EntityDef
    async with OwnerSessionLocal() as s:
        rows = (await s.execute(
            select(WorkflowDef, EntityDef.key).join(EntityDef, WorkflowDef.entity_def_id == EntityDef.id)
        )).all()
    for wf, key in rows:
        if key not in ("lead", "customer"):       # only the documented pre-extension seeded entities
            continue
        for t in (wf.config or {}).get("transitions", []):
            g = t.get("guard")
            if g:
                assert gxl.validate_guard(g) == set(), \
                    f"seeded {key} guard unexpectedly reaches cross-record: {g!r}"
