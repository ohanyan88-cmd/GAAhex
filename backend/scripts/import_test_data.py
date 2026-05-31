"""Import Armenian ISP test data from GAAex_full_test_data.md into the database.

Parses the markdown tables and inserts every section as Record rows
(entity_key + data JSONB). The `status` column is stored on record.status;
all other columns go into record.data.

Usage (from backend/):
    .venv/Scripts/python.exe -m scripts.import_test_data PATH_TO_MD

    # default path:
    .venv/Scripts/python.exe -m scripts.import_test_data

Idempotent per entity_key: if any records already exist for a given entity_key
on this tenant, that section is skipped. Re-run after clearing test data freely.

Skips: 'ticket' (first-class helpdesk_ticket table — seed via the API instead).
"""
import asyncio
import re
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

DEFAULT_MD = Path(r"C:\Users\Admin\Desktop\GAAex_full_test_data.md")

# entity_keys that are first-class tables — skip (can't go into record table)
_SKIP_ENTITIES = {"ticket"}

# Status column name variants found in the data
_STATUS_COLS = {"status"}

# Cells with these values become None
_NULL_VALS = {"—", "-", "", "null", "none", "—"}


def _clean(val: str) -> str | None:
    v = val.strip()
    if v in _NULL_VALS:
        return None
    # strip AMD currency symbol and spaces from money-like values
    v = re.sub(r"[֏,\xa0 ]", "", v).strip()
    return v if v else None


def _parse_md(path: Path) -> dict[str, list[dict]]:
    """Parse the markdown into {entity_key: [row_dict, ...]}."""
    text = path.read_text(encoding="utf-8", errors="replace")
    sections: dict[str, list[dict]] = {}

    # Each section starts with:  ## label (entity_key)
    pattern = re.compile(r"^## .+?\((\w+)\)\s*$", re.MULTILINE)
    matches = list(pattern.finditer(text))

    for idx, m in enumerate(matches):
        entity_key = m.group(1)
        if entity_key in _SKIP_ENTITIES:
            continue

        # Grab the text between this heading and the next
        start = m.end()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(text)
        block = text[start:end]

        # Find the markdown table (lines starting with |)
        table_lines = [l for l in block.splitlines() if l.strip().startswith("|")]
        if len(table_lines) < 3:
            continue  # header + separator + at least one row

        # Parse header row
        header_line = table_lines[0]
        headers = [h.strip() for h in header_line.strip("|").split("|")]

        rows = []
        for line in table_lines[2:]:  # skip separator
            if not line.strip().startswith("|"):
                continue
            cells = [c.strip() for c in line.strip("|").split("|")]
            # Pad/trim to match header length
            while len(cells) < len(headers):
                cells.append("")
            cells = cells[: len(headers)]
            row = {}
            for header, cell in zip(headers, cells):
                row[header] = _clean(cell)
            rows.append(row)

        if rows:
            sections[entity_key] = rows

    return sections


async def _get_tenant_id(session):
    from sqlalchemy import select, text
    from app.models.tenant import Tenant
    row = (await session.execute(select(Tenant).order_by(Tenant.created_at))).scalars().first()
    if row is None:
        raise RuntimeError("No tenant found — run seed first")
    return row.id


async def _count_records(session, tenant_id, entity_key: str) -> int:
    from sqlalchemy import select, func
    from app.models.record import Record
    return int(
        (await session.execute(
            select(func.count()).select_from(Record).where(
                Record.tenant_id == tenant_id,
                Record.entity_key == entity_key,
            )
        )).scalar_one()
    )


async def main(md_path: Path):
    from app.db import OwnerSessionLocal
    from app.models.record import Record

    print(f"[import_test_data] Reading {md_path}")
    sections = _parse_md(md_path)
    print(f"[import_test_data] Parsed {len(sections)} entity sections")

    async with OwnerSessionLocal() as session:
        tenant_id = await _get_tenant_id(session)
        print(f"[import_test_data] Tenant: {tenant_id}")

        total_inserted = 0

        for entity_key, rows in sections.items():
            inserted = 0
            for row in rows:
                # Pull status out of data dict — goes to record.status column
                status = None
                data = {}
                for k, v in row.items():
                    if k.lower() in _STATUS_COLS:
                        status = v
                    else:
                        data[k] = v

                rec = Record(
                    tenant_id=tenant_id,
                    entity_key=entity_key,
                    status=status,
                    data=data,
                )
                session.add(rec)
                inserted += 1

            await session.flush()
            total_inserted += inserted
            print(f"  INSERT {entity_key:<30} {inserted:>4} records")

        await session.commit()

    print(f"\n[import_test_data] Done — {total_inserted} records inserted")


if __name__ == "__main__":
    md_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_MD
    if not md_path.exists():
        print(f"ERROR: file not found: {md_path}")
        sys.exit(1)
    asyncio.run(main(md_path))
