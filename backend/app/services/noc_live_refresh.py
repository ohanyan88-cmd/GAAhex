"""NOC live-refresh — pull live topology from an OLT and reconcile the DB tree.

When a NOC user clicks "refresh" on an OLT in the dashboard, this service:

  1. Builds the vendor driver for the OLT Record via the factory.
  2. Calls ``pull_topology()`` on the driver (vendor-extension method, NOT part
     of the ``OltDriver`` Protocol — Protocol stays vendor-agnostic).
  3. Reconciles the chassis/card/port/ONU rows for THIS OLT only:
     * Existing rows that still appear upstream are kept (preserves
       ``customer_id`` / ``service_id`` / ``distance_m`` bindings).
     * Rows that disappear upstream are soft-removed (``status='removed'``).
     * New ports / ONUs are inserted.
  4. Returns counts so the router can echo a summary.

Caller owns the commit — this function only ``flush``es. The router commits.

Vendor support today: ``vsol_v1600``. Adding a new vendor = giving its driver a
``pull_topology()`` method with the same shape and adding the vendor key to
:data:`SUPPORTED_VENDORS`. Other vendors raise :class:`OltNotSupportedError`
from this entry point (driver.get_status() still works for them).
"""
from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.olt_tree import OltCard, OltChassis, OltPort, Onu
from ..models.record import Record
from .olt import (
    OltError,
    OltNotSupportedError,
    get_driver_for_olt,
)


# Vendors that expose a ``pull_topology()`` method we can call from here.
SUPPORTED_VENDORS = frozenset({"vsol_v1600"})


async def refresh_olt_topology(
    session: AsyncSession,
    olt_record: Record,
) -> dict[str, Any]:
    """Pull live topology from the OLT and reconcile DB rows for it.

    Returns ``{"vendor": str, "hostname": str | None, "model": str,
    "ports": int, "onus_active": int, "onus_removed": int}``.

    Raises :class:`OltNotSupportedError` if the OLT's vendor doesn't expose a
    ``pull_topology()`` extension method. Other :class:`OltError` subclasses
    bubble up unchanged (connection failure, command rejection, etc.).
    """
    vendor = (olt_record.data or {}).get("vendor", "").lower()
    if vendor not in SUPPORTED_VENDORS:
        raise OltNotSupportedError(
            f"Live refresh is not implemented for vendor {vendor!r}; "
            f"supported: {sorted(SUPPORTED_VENDORS)}"
        )

    driver = await get_driver_for_olt(olt_record)
    try:
        pull = getattr(driver, "pull_topology", None)
        if pull is None:
            raise OltNotSupportedError(
                f"Driver for vendor {vendor!r} does not expose pull_topology()"
            )
        topo = await pull()
    finally:
        try:
            await driver.close()
        except OltError:
            pass
        except Exception:  # noqa: BLE001
            pass

    return await _reconcile_topology(
        session,
        olt_record=olt_record,
        topology=topo,
    )


async def _reconcile_topology(
    session: AsyncSession,
    *,
    olt_record: Record,
    topology: dict[str, Any],
) -> dict[str, Any]:
    """Idempotent reconcile: upsert chassis/card/port/ONU rows for this OLT.

    Reconcile rules:

    * Exactly ONE chassis (slot 1) and ONE card (slot 1, type GPON) per V1600.
      The V1600 is a fixed-form-factor 8-port device; we don't try to model it
      as a stacked chassis.
    * Ports keyed by ``port_no`` — we keep existing rows (preserves any binding)
      and flip their status to match upstream, insert ports we haven't seen,
      and tombstone ports that vanished.
    * ONUs keyed by serial — same upsert/tombstone logic, and we re-parent an
      ONU if it moved between ports.
    """
    tenant_id = olt_record.tenant_id
    olt_record_id = olt_record.id

    hostname = topology.get("hostname")
    model = topology.get("model") or "V1600G1-B"
    sw_version = topology.get("sw_version")
    pulled_ports = list(topology.get("ports") or [])

    # Stash the lightweight aggregations on the OLT Record so the analytics
    # endpoint can serve them without re-SSHing. These come from the same
    # running-config pull — VLAN inventory, DBA profile catalogue, and
    # per-line-profile ONU counts (subscription-tier distribution).
    from sqlalchemy.orm.attributes import flag_modified as _flag
    olt_record.data = dict(olt_record.data or {})
    olt_record.data["snapshot"] = {
        "hostname": hostname,
        "model": model,
        "sw_version": sw_version,
        "vlans": topology.get("vlans") or [],
        "dba_profiles": topology.get("dba_profiles") or [],
        "line_profile_counts": topology.get("line_profile_counts") or [],
        "line_profile_defs": topology.get("line_profile_defs") or [],
        "onu_details": topology.get("onu_details") or [],
    }
    _flag(olt_record, "data")

    # ----- chassis (single, slot 1) -----
    chassis = (await session.execute(
        select(OltChassis).where(
            OltChassis.tenant_id == tenant_id,
            OltChassis.olt_record_id == olt_record_id,
            OltChassis.slot_no == 1,
        )
    )).scalar_one_or_none()
    if chassis is None:
        chassis = OltChassis(
            tenant_id=tenant_id,
            olt_record_id=olt_record_id,
            slot_no=1,
            model=model,
            status="active",
        )
        session.add(chassis)
        await session.flush()
    else:
        chassis.model = model
        chassis.status = "active"

    # ----- card (single, slot 1, GPON) -----
    card = (await session.execute(
        select(OltCard).where(
            OltCard.tenant_id == tenant_id,
            OltCard.chassis_id == chassis.id,
            OltCard.slot_no == 1,
        )
    )).scalar_one_or_none()
    port_count = len(pulled_ports)
    if card is None:
        card = OltCard(
            tenant_id=tenant_id,
            chassis_id=chassis.id,
            slot_no=1,
            type="GPON",
            port_count=port_count,
            status="active",
            fw_version=sw_version,
        )
        session.add(card)
        await session.flush()
    else:
        card.type = "GPON"
        card.port_count = port_count
        card.status = "active"
        if sw_version:
            card.fw_version = sw_version

    # ----- ports -----
    existing_ports = (await session.execute(
        select(OltPort).where(
            OltPort.tenant_id == tenant_id,
            OltPort.card_id == card.id,
        )
    )).scalars().all()
    ports_by_no: dict[int, OltPort] = {p.port_no: p for p in existing_ports}
    seen_port_nos: set[int] = set()
    port_by_no: dict[int, OltPort] = {}
    for p in pulled_ports:
        port_no = int(p["port_no"])
        seen_port_nos.add(port_no)
        status = p.get("status") or "up"
        row = ports_by_no.get(port_no)
        if row is None:
            row = OltPort(
                tenant_id=tenant_id,
                card_id=card.id,
                port_no=port_no,
                type=p.get("type") or "GPON",
                status=status,
            )
            session.add(row)
            await session.flush()
        else:
            row.type = p.get("type") or "GPON"
            row.status = status
        port_by_no[port_no] = row
    # NO tombstoning per Gev: refresh is additive only. Ports that vanish from
    # the live config keep their prior DB state; they're not removed or
    # downgraded. Live truth is reflected for what's present, history is kept
    # for what isn't.

    # ----- ONUs -----
    # Build serial → (port_id, payload) for upstream state.
    upstream_onus: dict[str, dict[str, Any]] = {}
    for p in pulled_ports:
        port_no = int(p["port_no"])
        port_row = port_by_no.get(port_no)
        if port_row is None:
            continue
        for onu in (p.get("onus") or []):
            serial = onu.get("serial")
            if not serial:
                continue
            upstream_onus[serial] = {
                "port_id": port_row.id,
                "status": onu.get("status") or "active",
            }

    # All current ONU rows for this OLT (any port on the card).
    port_ids = [port_by_no[k].id for k in port_by_no]
    existing_onus: list[Onu] = []
    if port_ids:
        existing_onus = (await session.execute(
            select(Onu).where(
                Onu.tenant_id == tenant_id,
                Onu.port_id.in_(port_ids),
            )
        )).scalars().all()
    by_serial: dict[str, Onu] = {o.serial: o for o in existing_onus}

    onus_active = 0
    onus_inserted = 0
    for serial, payload in upstream_onus.items():
        row = by_serial.get(serial)
        if row is None:
            row = Onu(
                tenant_id=tenant_id,
                port_id=payload["port_id"],
                serial=serial,
                status=payload["status"],
            )
            session.add(row)
            onus_inserted += 1
        else:
            row.port_id = payload["port_id"]
            row.status = payload["status"]
        onus_active += 1

    # NO tombstoning per Gev: ONUs that vanish from the live config keep their
    # prior DB rows untouched. Refresh is additive — it can ADD new ONUs and
    # UPDATE existing ones, but never removes or downgrades history. If a
    # serial truly needs purging the operator deletes it through a dedicated
    # endpoint, not through the live-poll path.

    await session.flush()

    return {
        "vendor": (olt_record.data or {}).get("vendor"),
        "hostname": hostname,
        "model": model,
        "sw_version": sw_version,
        "ports": port_count,
        "onus_active": onus_active,
        "onus_inserted": onus_inserted,
    }


__all__ = [
    "SUPPORTED_VENDORS",
    "refresh_olt_topology",
]
