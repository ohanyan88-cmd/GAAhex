"""Record export (launch-critical H73).

`GET /api/{slug}/export?format=csv|json|xlsx|pdf` downloads the records the caller can view for an
entity — using the SAME org-scope + view-gate + q/filter/sort pipeline as the list endpoint, so an
export never leaks beyond what's on screen. Read-only.

Formats
-------
csv   (default) — streaming plain-text CSV; stdlib only.
json            — JSON array; stdlib only.
xlsx            — OOXML workbook with bold header row; stdlib only (no openpyxl/xlsxwriter dep).
pdf             — Branded tabular PDF: tenant logo_text + entity title + date in header; stdlib only.

Branding for xlsx/pdf comes from tenant settings (logo_text, currency, name) — nothing hardcoded.
Money values stored as integer luma are displayed via format_money(luma, currency) (÷100, grouped).

Dependency note: no third-party PDF/XLSX libraries are required or added.  Both formats are
rendered by the stdlib-only helpers in app/export_formats.py.
"""
import csv
import io
import json
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import Record, Tenant, User
from ..access import load_grants, can
from .. import gxl
from .auth import current_user
# reuse the records engine's exact helpers so filtering/scoping stays in lock-step with the list view
from .records import _entity, _fields, _node_paths, _matches_q, _sort_value
from ..export_formats import build_xlsx, build_pdf

router = APIRouter(prefix="/api", tags=["export"])

_VALID_FORMATS = {"csv", "json", "xlsx", "pdf"}


async def _tenant(s: AsyncSession, tenant_id) -> Tenant:
    """Load the tenant row for branding (logo_text, currency, name)."""
    row = (await s.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Tenant not found")
    return row


async def _viewable_filtered(s: AsyncSession, user: User, ent, q, filter_expr, sort) -> list[Record]:
    """The records the caller may view for `ent`, after q/filter/sort — identical to list_records."""
    grants = await load_grants(s, user)
    if not can(grants, ent.key, "view"):
        raise HTTPException(403, f"Not allowed: {ent.key}.view")
    paths = await _node_paths(s, user.tenant_id)
    rows = (await s.execute(
        select(Record).where(Record.tenant_id == user.tenant_id, Record.entity_key == ent.key).order_by(Record.created_at)
    )).scalars().all()

    # 1. scope filter (access control) — before any user-supplied filtering
    visible = [
        r for r in rows
        if can(grants, ent.key, "view", paths.get(str(r.owner_node_id)) if r.owner_node_id else None)
    ]
    # 2. free-text search
    if q:
        needle = q.lower()
        visible = [r for r in visible if _matches_q(r, needle)]
    # 3. GXL filter (per record; broken/false excludes — never 500)
    if filter_expr:
        visible = [r for r in visible if gxl.evaluate(filter_expr, {**(r.data or {}), "status": r.status})]
    # 4. sort (None values last; coerce to string if uncomparable)
    if sort:
        desc = sort.startswith("-")
        field = sort[1:] if desc else sort
        present = [r for r in visible if _sort_value(r, field) is not None]
        missing = [r for r in visible if _sort_value(r, field) is None]
        try:
            present = sorted(present, key=lambda r: _sort_value(r, field), reverse=desc)
        except TypeError:
            present = sorted(present, key=lambda r: str(_sort_value(r, field)), reverse=desc)
        visible = present + missing
    return visible


def _cell(v) -> str:
    """Render one value as a CSV cell."""
    if v is None:
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, list):
        return "; ".join("" if x is None else str(x) for x in v)
    return str(v)


@router.get("/{slug}/export")
async def export_records(
    slug: str,
    format: str = "csv",
    q: str | None = None,
    filter: str | None = None,
    sort: str | None = None,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Export an entity's viewable records as CSV, JSON, XLSX, or PDF.

    Same filters + access control as the list view.  Empty result → a valid empty file (header
    only for CSV/XLSX; header band only for PDF), never an error.

    ?format=csv   (default)  — streaming plain CSV
    ?format=json             — JSON array
    ?format=xlsx             — OOXML workbook, bold header row
    ?format=pdf              — branded PDF: tenant logo_text + entity title + date in header
    """
    fmt = (format or "csv").lower()
    if fmt not in _VALID_FORMATS:
        raise HTTPException(400, f"format must be one of {sorted(_VALID_FORMATS)}")

    ent = await _entity(s, user.tenant_id, slug)
    fields = await _fields(s, ent.id)
    data_fields = [f for f in fields if f.type != "status"]   # status-type field → folded into core `status`
    keys = [f.key for f in data_fields]
    header = [f.label for f in data_fields] + ["Status", "ID", "Created At"]

    records = await _viewable_filtered(s, user, ent, q, filter, sort)
    today = date.today()
    filename = f"{slug}-{today:%Y%m%d}.{fmt}"

    # ------------------------------------------------------------------
    # JSON (unchanged)
    # ------------------------------------------------------------------
    if fmt == "json":
        rows = []
        for r in records:
            obj = {k: (r.data or {}).get(k) for k in keys}
            obj["status"] = r.status
            obj["id"] = str(r.id)
            obj["created_at"] = r.created_at.isoformat() if r.created_at else None
            rows.append(obj)
        return Response(
            content=json.dumps(rows, ensure_ascii=False),
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    # ------------------------------------------------------------------
    # CSV — streamed, one row at a time (unchanged)
    # ------------------------------------------------------------------
    if fmt == "csv":
        def _csv_rows():
            buf = io.StringIO()
            writer = csv.writer(buf)
            writer.writerow(header)
            yield buf.getvalue()
            buf.seek(0); buf.truncate(0)
            for r in records:
                line = [_cell((r.data or {}).get(k)) for k in keys]
                line += [_cell(r.status), str(r.id), r.created_at.isoformat() if r.created_at else ""]
                writer.writerow(line)
                yield buf.getvalue()
                buf.seek(0); buf.truncate(0)

        return StreamingResponse(
            _csv_rows(),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    # ------------------------------------------------------------------
    # XLSX and PDF both need branding — load tenant once
    # ------------------------------------------------------------------
    t = await _tenant(s, user.tenant_id)
    currency: str = t.currency or "AMD"
    logo_text: str = t.logo_text or t.name or "GAAhex"

    # Build flat rows (all string cells, same as CSV but without streaming)
    data_rows = []
    for r in records:
        line = [_cell((r.data or {}).get(k)) for k in keys]
        line += [_cell(r.status), str(r.id), r.created_at.isoformat() if r.created_at else ""]
        data_rows.append(line)

    # ------------------------------------------------------------------
    # XLSX — stdlib OOXML writer (no openpyxl / xlsxwriter dep)
    # ------------------------------------------------------------------
    if fmt == "xlsx":
        content = build_xlsx(header, data_rows)
        return Response(
            content=content,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    # ------------------------------------------------------------------
    # PDF — stdlib raw PDF writer, branded header (no reportlab / weasyprint dep)
    # ------------------------------------------------------------------
    # fmt == "pdf"
    report_title = f"{ent.label or slug} Export"
    content = build_pdf(
        header=header,
        rows=data_rows,
        logo_text=logo_text,
        report_title=report_title,
        generated_date=today,
        currency=currency,
    )
    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
