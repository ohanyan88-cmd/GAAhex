"""M1-A Wave 3: backfill RLS tenant_isolation on tables added after 3a9203795d07.

Twenty-seven tenant-scoped tables landed AFTER the original enable-RLS migration
(``3a9203795d07``) and never got the ``tenant_isolation`` policy. Without the policy,
the ``gaaex_app`` NOSUPERUSER role would either get full visibility (if RLS not enabled)
or get blocked outright. Either way: not isolated. This wave fixes that by replicating the
exact pattern from ``3a9203795d07`` (same NULLIF-guarded predicate, same USING + WITH CHECK,
no FORCE) over every missing table.

Grants are NOT re-issued here — ``3a9203795d07`` already ran
``ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES
TO gaaex_app``, so every table created since then was auto-granted to ``gaaex_app`` at
creation time. (Same reasoning as ``642fa959d432``, which did the same for
``notification_pref``.)

Note on the M1-A audit: the audit listed ``product_version`` as missing RLS, but the model
has no ``tenant_id`` column — it is tenant-scoped indirectly via ``product_id -> product``.
RLS-by-tenant-GUC doesn't apply to it; it's omitted here. Final count: 27 tables.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'e7f4a2b9c8d1'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Twenty-seven tables that have ``tenant_id`` NOT NULL and need the tenant_isolation policy.
# (``product_version`` from the audit is omitted — it has no tenant_id; it's scoped via product_id.)
_TABLES = [
    # c1d2e3f4a5b6 — feature flags
    "feature_flag",
    # d3e4f5a6b7c8 — Studio page bindings
    "page_binding",
    # f7a2d5c9b134 — Phase A.1 tariffs (product_version omitted: no tenant_id column)
    "tariff_plan",
    # b8e4d2f7a1c9 — Phase A.3 invoice allocations + credit notes
    "payment_allocation",
    "credit_note",
    # c9f5a3b7e2d1 — Phase B.2 dunning
    "dunning_policy",
    "dunning_case",
    "service_action_log",
    # e3b2f9c1d4a7 — Phase B.3 revenue assurance
    "ra_finding",
    "ra_scan_run",
    # d8a3f1e2c5b6 — Phase B.1 stage-8 payment methods
    "payment_method",
    # e9c2d4f7a1b3 — NOC A: installation board
    "splitter_strand_allocation",
    "vlan_assignment",
    "cpe_binding",
    # f2a8c4b9d7e3 — NOC B: OLT tree, telemetry, GPS
    "olt_chassis",
    "olt_card",
    "olt_port",
    "onu",
    "optical_power_sample",
    "otdr_test",
    "technician_location_ping",
    # a1b2c3d4e5f6 — NOC C: PostGIS, IPAM, broadcast
    "fiber_route",
    "outage_path",
    "ip_assignment",
    "asset_location_history",
    "radius_session",
    "mass_broadcast",
]


def upgrade() -> None:
    for table in _TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;")
        # Identical pattern to 3a9203795d07 / 642fa959d432: NULLIF-guarded predicate so an unset
        # or empty GUC yields NULL → default-deny (rather than raising on ''::uuid). USING governs
        # read/update/delete; WITH CHECK blocks cross-tenant inserts.
        op.execute(f"""
            CREATE POLICY tenant_isolation ON {table}
              USING (tenant_id = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid)
              WITH CHECK (tenant_id = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid);
        """)


def downgrade() -> None:
    for table in reversed(_TABLES):
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table};")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY;")
