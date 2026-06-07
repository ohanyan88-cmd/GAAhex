"""Record export (launch-critical H73).

`GET /api/{slug}/export?format=csv|json|xlsx` downloads the records the caller can view for an
entity — using the SAME org-scope + view-gate + q/filter/sort pipeline as the list endpoint, so an
export never leaks beyond what's on screen. Read-only.

Formats
-------
csv   (default) — streaming plain-text CSV (UTF-8 BOM so Excel renders non-Latin scripts); stdlib only.
json            — JSON array; stdlib only.
xlsx            — OOXML workbook with bold header row; stdlib only (no openpyxl/xlsxwriter dep).

Dependency note: no third-party XLSX libraries are required or added — rendered by the
stdlib-only helper in app/export_formats.py.
"""
import csv
import io
import json
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import Record, User, Event
from ..access import load_grants, can
from .. import gxl
from .auth import current_user
# reuse the records engine's exact helpers so filtering/scoping stays in lock-step with the list view
from .records import _entity, _fields, _node_paths, _matches_q, _sort_value
from ..export_formats import build_xlsx

router = APIRouter(prefix="/api", tags=["export"])

_VALID_FORMATS = {"csv", "json", "xlsx", "pdf"}


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


_DANGEROUS_LEADERS = frozenset("=+-@\t\r")


def _neutralize_formula(s: str) -> str:
    """Prefix a leading apostrophe to defang Excel / LibreOffice formula injection (H19, D32).

    Per OWASP CSV-Injection guidance, any cell whose first character is one of
    ``= + - @ \\t \\r`` (or whose first non-whitespace character is ``= + - @``) is
    treated as a formula by spreadsheet apps. Prepending ``'`` forces the cell to render
    literally without changing the visible content (the apostrophe is consumed by the
    spreadsheet at display time). Pass-through for benign values keeps CSV diff-friendly.

    Note: tab (``\\t``) and CR (``\\r``) are dangerous *as leading characters* but are also
    whitespace; ``lstrip()`` alone would erase them and miss the threat. We check the raw
    first byte first, then fall back to the lstripped form for the symbolic leaders.
    """
    if not s:
        return s
    if s[:1] in _DANGEROUS_LEADERS:
        return "'" + s
    lead = s.lstrip()
    if lead and lead[:1] in _DANGEROUS_LEADERS:
        return "'" + s
    return s


def _cell(v) -> str:
    """Render one value as a CSV / XLSX cell, with formula-injection neutralization."""
    if v is None:
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, list):
        s = "; ".join("" if x is None else str(x) for x in v)
    else:
        s = str(v)
    return _neutralize_formula(s)


def _pdf_cell(v) -> str:
    """Render a value for the PDF — no formula neutralization (a PDF isn't a spreadsheet)."""
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
    """Export an entity's viewable records as CSV, JSON, or XLSX.

    Same filters + access control as the list view.  Empty result → a valid empty file
    (header only), never an error.

    ?format=csv   (default)  — streaming plain CSV (UTF-8 BOM)
    ?format=json             — JSON array
    ?format=xlsx             — OOXML workbook, bold header row
    """
    fmt = (format or "csv").lower()
    if fmt not in _VALID_FORMATS:
        raise HTTPException(400, f"format must be one of {sorted(_VALID_FORMATS)}")

    ent = await _entity(s, user.tenant_id, slug)
    fields = await _fields(s, ent.id)
    data_fields = [f for f in fields if f.type != "status"]   # status-type field → folded into core `status`
    keys = [f.key for f in data_fields]
    # A field may override its export column header via config.export_label (e.g. name → "ԱԱ").
    def _col(f):
        return (f.config or {}).get("export_label") or f.label
    header = [_col(f) for f in data_fields] + ["Status", "ID", "Created At", "Created By"]

    records = await _viewable_filtered(s, user, ent, q, filter, sort)
    today = date.today()
    filename = f"{slug}-{today:%Y%m%d}.{fmt}"

    # Created By — resolved from each record's create Event actor → user display name.
    # Two batched lookups (events, then users); records without a create event show "—".
    creator_by_record: dict = {}
    rec_ids = [r.id for r in records]
    if rec_ids:
        ev_rows = (await s.execute(
            select(Event.record_id, Event.actor_id).where(
                Event.tenant_id == user.tenant_id,
                Event.entity_key == ent.key,
                func.upper(Event.type) == "CREATE",
                Event.record_id.in_(rec_ids),
            )
        )).all()
        actor_by_record: dict = {}
        for rid, aid in ev_rows:
            if rid is not None and rid not in actor_by_record:
                actor_by_record[rid] = aid
        actor_ids = {a for a in actor_by_record.values() if a is not None}
        name_by_actor: dict = {}
        if actor_ids:
            u_rows = (await s.execute(
                select(User.id, User.name, User.email).where(User.id.in_(actor_ids))
            )).all()
            name_by_actor = {uid: (nm or em) for uid, nm, em in u_rows}
        creator_by_record = {rid: name_by_actor.get(aid) for rid, aid in actor_by_record.items()}

    def _creator(r) -> str:
        return creator_by_record.get(r.id) or "—"

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
            obj["created_by"] = _creator(r)
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
            # UTF-8 BOM so spreadsheet apps (Excel) detect the encoding and render
            # non-Latin scripts (e.g. Armenian) correctly instead of mojibake.
            yield "﻿" + buf.getvalue()
            buf.seek(0); buf.truncate(0)
            for r in records:
                line = [_cell((r.data or {}).get(k)) for k in keys]
                line += [_cell(r.status), str(r.id), r.created_at.isoformat() if r.created_at else "", _creator(r)]
                writer.writerow(line)
                yield buf.getvalue()
                buf.seek(0); buf.truncate(0)

        return StreamingResponse(
            _csv_rows(),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    # ------------------------------------------------------------------
    # XLSX — stdlib OOXML writer (no openpyxl / xlsxwriter dep). The only remaining
    # binary format; csv/json already returned above.
    # ------------------------------------------------------------------
    data_rows = []
    for r in records:
        line = [_cell((r.data or {}).get(k)) for k in keys]
        line += [_cell(r.status), str(r.id), r.created_at.isoformat() if r.created_at else "", _creator(r)]
        data_rows.append(line)

    # ------------------------------------------------------------------
    # PDF — Armenian-capable tabular PDF (reportlab + DejaVu; lazy import).
    # A print format: curate to a few key columns so the table stays readable
    # (a 30-column dump squeezes text to one char per line). Full data → csv/xlsx.
    # ------------------------------------------------------------------
    if fmt == "pdf":
        from ..contract_pdf import build_table_pdf

        priority = ["name", "surname", "company_name", "phone", "email",
                    "region", "city", "address", "service_type", "source"]
        label_by_key = {f.key: _col(f) for f in data_fields}
        pdf_keys = [k for k in priority if k in keys][:7]
        if len(pdf_keys) < 3:                       # entity without the usual CRM keys → first few
            pdf_keys = keys[:6]
        pdf_header = [label_by_key[k] for k in pdf_keys] + ["Status", "Created"]
        pdf_rows = []
        for r in records:
            line = [_pdf_cell((r.data or {}).get(k)) for k in pdf_keys]
            line += [_pdf_cell(r.status), r.created_at.strftime("%Y-%m-%d") if r.created_at else ""]
            pdf_rows.append(line)
        note = ""
        if len(data_fields) > len(pdf_keys):
            note = (f"Showing {len(pdf_keys)} of {len(data_fields)} fields — "
                    f"download CSV or XLSX for the complete data.")
        content = build_table_pdf(pdf_header, pdf_rows, f"{slug} export", f"{today:%Y-%m-%d}", note)
        return Response(
            content=content,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    content = build_xlsx(header, data_rows)
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
