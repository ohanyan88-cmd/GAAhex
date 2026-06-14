"""B2 — status-vocabulary drift guard: single source of truth, no exception.

The audit (HARD-AUDIT-2026-06-14, DATA-1/2/3) found the customer state machine DEAD because its
StatusDef keys (lowercase active/suspended/terminated), its records, and its WorkflowDef transitions
(UPPER PROSPECT/CHURNED, stale) disagreed — three "sources of truth" for one entity's status set.
B1a collapsed customer to ONE UPPER_SNAKE set. This test makes that property mechanical and permanent.

Scope: the CONFIG of the canonical config-driven entities (the SST/CRM core). We check StatusDef keys
and WorkflowDef transition ENDPOINTS — the per-entity status REGISTRY, which is seeded once and stable.
We deliberately do NOT scan record.status: in the shared session DB hundreds of unrelated tests create
records with arbitrary statuses (a fixture's own concern, not config drift) — the activation-path record
status is covered where it matters by the e2e loop tests (test_loop_e2e asserts status == "ACTIVE").
The live-DB record sweep is verified separately against the migration-built dev/prod DB.

Invariant, per canonical entity:
  1. CONSISTENCY (no exception) — every transition endpoint MUST be a declared StatusDef key. A
     transition pointing at a key the StatusDef set doesn't contain is exactly the customer bug.
  2. CASING — StatusDef keys + transition endpoints MUST be UPPER_SNAKE (SPEC §7), EXCEPT the iron-rule
     SST install-pipeline entities (lead, order), whose lowercase multi-word stage keys are a deliberate,
     documented design (seed_lifecycle_statuses / seed_pipeline). They are still held to rule 1.
"""
import re

import pytest
from sqlalchemy import select

from app.db import OwnerSessionLocal
from app.models.meta import EntityDef, StatusDef, WorkflowDef

_UPPER_SNAKE = re.compile(r"^[A-Z][A-Z0-9_]*$")

# The canonical config-driven entities seeded in every environment (seed.py build_crm_entities +
# seed_lifecycle_statuses). Their StatusDef registry is the single source of truth the audit was about.
_CANONICAL_ENTITIES = {"customer", "lead", "order", "deal", "ticket"}

# B1b (Gev 2026-06-14, "no exception"): lead + order were UPPER-cased to match the frontend SST
# (lifecycle.ts) — there is now NO casing exception. Every canonical entity is UPPER_SNAKE.
_SST_LOWERCASE_ENTITIES: set[str] = set()


@pytest.mark.asyncio
async def test_status_vocabulary_single_source_of_truth():
    casing_violations: list[str] = []
    consistency_violations: list[str] = []

    # PER-STATEMENT audit_tenant_filter bypass (the safe form — same as routers/auth.py). The
    # per-CONNECTION form (`s.connection(execution_options=...)`) leaks the option onto the pooled
    # connection in the test env and poisons every later test — do NOT use it here.
    async with OwnerSessionLocal() as s:
        ents = (await s.execute(
            select(EntityDef).where(EntityDef.key.in_(_CANONICAL_ENTITIES))
            .execution_options(audit_tenant_filter=False)
        )).scalars().all()
        for ent in ents:
            sdefs = (await s.execute(
                select(StatusDef).where(StatusDef.entity_def_id == ent.id)
                .execution_options(audit_tenant_filter=False)
            )).scalars().all()
            keys = {sd.key for sd in sdefs}
            if not keys:
                continue
            casing_exempt = ent.key in _SST_LOWERCASE_ENTITIES

            if not casing_exempt:
                for sd in sdefs:
                    if not _UPPER_SNAKE.match(sd.key):
                        casing_violations.append(f"{ent.key}: StatusDef key {sd.key!r} is not UPPER_SNAKE")

            wfs = (await s.execute(
                select(WorkflowDef).where(WorkflowDef.entity_def_id == ent.id)
                .execution_options(audit_tenant_filter=False)
            )).scalars().all()
            for wf in wfs:
                for tr in (wf.config or {}).get("transitions", []):
                    for endpoint in (tr.get("from"), tr.get("to")):
                        if endpoint is None:
                            continue
                        if endpoint not in keys:
                            consistency_violations.append(
                                f"{ent.key}: transition endpoint {endpoint!r} is not a declared "
                                f"StatusDef key {sorted(keys)}"
                            )
                        if not casing_exempt and not _UPPER_SNAKE.match(endpoint):
                            casing_violations.append(
                                f"{ent.key}: transition endpoint {endpoint!r} is not UPPER_SNAKE"
                            )

    assert not consistency_violations, (
        "Status SINGLE-SOURCE-OF-TRUTH drift (a transition points at a key its StatusDef set does not "
        "contain — the customer-bug class):\n  " + "\n  ".join(sorted(set(consistency_violations)))
    )
    assert not casing_violations, (
        "Status CASING drift (non-UPPER_SNAKE outside the documented SST entities "
        f"{sorted(_SST_LOWERCASE_ENTITIES)}):\n  " + "\n  ".join(sorted(set(casing_violations)))
    )
