"""Audit v4 D4 close-out — PROVE the PERFECT-TARGET I5 invariant is enforced by a real DB constraint.

I5 = exactly one ENTITY-LIFECYCLE WorkflowDef per entity. The partial unique index
``uq_workflow_def_one_per_entity`` on ``workflow_def(entity_def_id) WHERE entity_def_id IS NOT NULL``
must REJECT a second lifecycle WorkflowDef for the same entity — even under a DIFFERENT key, which the
plain ``uq_workflow_def_key`` UNIQUE(tenant_id, key) does NOT catch (that different-key/same-entity case
is the exact determinism hole the partial index exists to close). The SPEC §5 cross-entity automation
rows (``entity_def_id IS NULL``) must stay EXEMPT.

The forensic re-audit (G3) could only INSPECT this index read-only and left "I5 rejects a duplicate
INSERT" UNPROVEN. This builds a fresh ``alembic upgrade head`` scratch DB (the index is migration-only
DDL, absent from create_all) and proves the constraint actually fires under INSERT. All async tests
rely on asyncio_mode=auto (pytest.ini).
"""
import os
import sys
import uuid

import asyncpg
import pytest

sys.path.insert(0, os.path.dirname(__file__))  # so the sibling _migration_backed_db helper imports
import _migration_backed_db as mb


async def _seed_tenant_entity(c):
    tid, eid = uuid.uuid4(), uuid.uuid4()
    await c.execute("INSERT INTO tenant(id, name, status) VALUES($1,$2,'ACTIVE')", tid, "I5 Tenant")
    # Bind the tenant GUC so inserts satisfy any FORCE'd RLS policy (harmless if the owner bypasses RLS).
    await c.execute("SELECT set_config('gaahex.tenant_id', $1, false)", str(tid))
    await c.execute(
        "INSERT INTO entity_def(id, tenant_id, key, label, label_plural, route_slug, status) "
        "VALUES($1,$2,'thing','Thing','Things','things','active')", eid, tid)
    return tid, eid


async def _insert_wf(c, tid, entity_def_id, key):
    await c.execute(
        "INSERT INTO workflow_def(id, tenant_id, entity_def_id, key, label) VALUES($1,$2,$3,$4,$5)",
        uuid.uuid4(), tid, entity_def_id, key, key)


async def test_i5_rejects_second_lifecycle_workflowdef_for_same_entity():
    scratch = mb.scratch_name("i5dup")
    url = await mb.build(scratch)
    try:
        c = await asyncpg.connect(url)
        try:
            tid, eid = await _seed_tenant_entity(c)
            await _insert_wf(c, tid, eid, "thing_lifecycle")  # 1st lifecycle WF — OK
            with pytest.raises(asyncpg.UniqueViolationError):
                # 2nd lifecycle WF for the SAME entity under a DIFFERENT key → the I5 partial unique
                # index must reject it (uq_workflow_def_key would NOT, since the keys differ).
                await _insert_wf(c, tid, eid, "thing_lifecycle_v2")
        finally:
            await c.close()
    finally:
        await mb.drop(scratch)


async def test_i5_exempts_null_entity_automation_workflowdefs():
    scratch = mb.scratch_name("i5null")
    url = await mb.build(scratch)
    try:
        c = await asyncpg.connect(url)
        try:
            tid, _ = await _seed_tenant_entity(c)
            # SPEC §5 automations carry entity_def_id IS NULL — the PARTIAL index must not constrain them.
            await _insert_wf(c, tid, None, "automation_w1")
            await _insert_wf(c, tid, None, "automation_w2")  # must NOT raise (null entity is exempt)
            n = await c.fetchval("SELECT COUNT(*) FROM workflow_def WHERE entity_def_id IS NULL")
            assert n == 2
        finally:
            await c.close()
    finally:
        await mb.drop(scratch)
