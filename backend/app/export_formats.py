"""Export format renderers for GAAhex record exports.

Stdlib-only — no third-party PDF or XLSX libraries required:

  XLSX: a minimal OOXML workbook written as a ZIP with XML parts.
        Opens correctly in Excel and LibreOffice Calc.

  PDF:  raw PDF 1.4 written byte-by-byte using only struct/io.
        Produces a clean tabular document with a branded header
        (logo_text + report title + generated date) and body rows.
        No images; fonts are the standard 14 PDF built-ins (Helvetica).

Money:  amounts stored as integer luma (minor units).
        `format_money(luma, currency)` → "15,000.00 AMD"
        Currency code comes from the tenant's settings — nothing hardcoded.
"""
from __future__ import annotations

import io
import struct
import zipfile
from datetime import date
from typing import Sequence

__all__ = ["build_xlsx", "build_pdf", "format_money"]


# ---------------------------------------------------------------------------
# Money helper
# ---------------------------------------------------------------------------

def format_money(luma: int | float | None, currency: str) -> str:
    """Integer luma → human display: e.g. 1_500_000 luma + 'AMD' → '15,000.00 AMD'."""
    if luma is None:
        return ""
    major = int(luma) / 100
    return f"{major:,.2f} {currency}"


# ---------------------------------------------------------------------------
# XLSX builder (stdlib only — OOXML / ZIP + XML)
# ---------------------------------------------------------------------------

def _xml_escape(s: str) -> str:
    return (
        s.replace("&", "&amp;")
         .replace("<", "&lt;")
         .replace(">", "&gt;")
         .replace('"', "&quot;")
         .replace("'", "&apos;")
    )


def build_xlsx(header: Sequence[str], rows: Sequence[Sequence[str]]) -> bytes:
    """Return a .xlsx workbook as bytes.

    The workbook has a single sheet named 'Export' with:
    - Row 1: bold header (style index 1)
    - Row 2+: data rows (style index 0)

    Values are always strings (shared strings table not used — inline strings
    keep the implementation minimal while remaining fully spec-compliant).
    """
    buf = io.BytesIO()

    # --- build XML parts -------------------------------------------------
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        '</Types>'
    )

    rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        '</Relationships>'
    )

    workbook = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
        ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<sheets><sheet name="Export" sheetId="1" r:id="rId1"/></sheets>'
        '</workbook>'
    )

    workbook_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
        '</Relationships>'
    )

    # Minimal styles: one font (normal) + one font (bold for header)
    styles = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<fonts count="2">'
        '<font><sz val="10"/><name val="Calibri"/></font>'
        '<font><b/><sz val="10"/><name val="Calibri"/></font>'
        '</fonts>'
        '<fills count="2">'
        '<fill><patternFill patternType="none"/></fill>'
        '<fill><patternFill patternType="gray125"/></fill>'
        '</fills>'
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        '<cellXfs count="2">'
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"/>'
        '</cellXfs>'
        '</styleSheet>'
    )

    # Build the sheet XML
    sheet_parts = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
        '<sheetData>',
    ]

    def _cell_xml(col_idx: int, row_idx: int, value: str, style: int) -> str:
        col_letter = _col_letter(col_idx)
        safe = _xml_escape(str(value) if value is not None else "")
        return f'<c r="{col_letter}{row_idx}" t="inlineStr" s="{style}"><is><t>{safe}</t></is></c>'

    # Header row (style=1 → bold)
    sheet_parts.append(f'<row r="1">')
    for ci, h in enumerate(header):
        sheet_parts.append(_cell_xml(ci, 1, h, 1))
    sheet_parts.append('</row>')

    # Data rows (style=0)
    for ri, row in enumerate(rows, start=2):
        sheet_parts.append(f'<row r="{ri}">')
        for ci, val in enumerate(row):
            sheet_parts.append(_cell_xml(ci, ri, val, 0))
        sheet_parts.append('</row>')

    sheet_parts += ['</sheetData>', '</worksheet>']
    sheet_xml = "".join(sheet_parts)

    # Pack into ZIP
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types)
        zf.writestr("_rels/.rels", rels)
        zf.writestr("xl/workbook.xml", workbook)
        zf.writestr("xl/_rels/workbook.xml.rels", workbook_rels)
        zf.writestr("xl/styles.xml", styles)
        zf.writestr("xl/worksheets/sheet1.xml", sheet_xml)

    return buf.getvalue()


def _col_letter(index: int) -> str:
    """0-based column index → Excel column letter (A, B, …, Z, AA, …)."""
    result = ""
    n = index
    while True:
        result = chr(ord("A") + n % 26) + result
        n = n // 26 - 1
        if n < 0:
            break
    return result


# ---------------------------------------------------------------------------
# PDF builder (stdlib-only raw PDF 1.4)
# ---------------------------------------------------------------------------
# Layout constants (points; 1pt = 1/72 inch)
_PAGE_W = 595  # A4 width
_PAGE_H = 842  # A4 height
_MARGIN = 40
_HEADER_H = 60   # top branding band height
_ROW_H = 16      # body row height
_COL_MIN = 60    # minimum column width
_FONT_BODY = 8
_FONT_HEADER = 10
_FONT_TITLE = 13


def build_pdf(
    header: Sequence[str],
    rows: Sequence[Sequence[str]],
    logo_text: str,
    report_title: str,
    generated_date: date,
    currency: str,
) -> bytes:
    """Return a branded tabular PDF as bytes.

    Header band: logo_text (large, left) + report_title (center) + date (right).
    Body: header row (bold) followed by data rows.  All stdlib, no deps.
    """
    out = io.BytesIO()

    def w(b: bytes) -> None:
        out.write(b)

    def ws(s: str) -> None:
        out.write(s.encode("latin-1", errors="replace"))

    offsets: list[int] = []

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    def _tell() -> int:
        return out.tell()

    def _pdf_str(s: str) -> str:
        """Escape a string for a PDF literal string."""
        return "(" + s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)") + ")"

    # ------------------------------------------------------------------
    # Calculate column widths (proportional, capped to page width)
    # ------------------------------------------------------------------
    usable = _PAGE_W - 2 * _MARGIN
    ncols = len(header)
    if ncols == 0:
        col_widths = []
    else:
        base = max(_COL_MIN, usable // ncols)
        col_widths = [base] * ncols
        # shrink evenly if overflow
        total = sum(col_widths)
        if total > usable:
            scale = usable / total
            col_widths = [int(w2 * scale) for w2 in col_widths]

    # ------------------------------------------------------------------
    # Build page content stream(s)
    # ------------------------------------------------------------------
    # We'll build page content as a list of PDF operator strings, then
    # paginate when rows overflow.

    def _page_content(page_rows: list[list[str]], first_page: bool) -> str:
        ops: list[str] = []

        # --- Branding header (first page only) ---
        if first_page:
            # Background rectangle for header band
            ops.append(f"0.95 0.95 0.97 rg")  # light grey fill
            ops.append(f"{_MARGIN - 5} {_PAGE_H - _MARGIN - _HEADER_H + 5} {usable + 10} {_HEADER_H} re f")
            ops.append("0 0 0 rg")  # back to black

            y_brand = _PAGE_H - _MARGIN - _HEADER_H + 18

            # logo_text — left, larger
            display_logo = logo_text or "GAAhex"
            ops.append("BT")
            ops.append("/F2 14 Tf")
            ops.append(f"0.2 0.4 0.8 rg")  # cobalt-ish
            ops.append(f"{_MARGIN} {y_brand + 14} Td")
            ops.append(_pdf_str(display_logo) + " Tj")
            ops.append("ET")
            ops.append("0 0 0 rg")

            # report title — center
            ops.append("BT")
            ops.append("/F2 13 Tf")
            title_x = _PAGE_W // 2 - len(report_title) * 3  # rough centering
            ops.append(f"{title_x} {y_brand + 14} Td")
            ops.append(_pdf_str(report_title) + " Tj")
            ops.append("ET")

            # date — right
            date_str = generated_date.strftime("%Y-%m-%d")
            ops.append("BT")
            ops.append("/F1 9 Tf")
            date_x = _PAGE_W - _MARGIN - len(date_str) * 5
            ops.append(f"{date_x} {y_brand + 14} Td")
            ops.append(_pdf_str(date_str) + " Tj")
            ops.append("ET")

            # horizontal rule below header
            ops.append(f"0.7 0.7 0.7 RG")
            ops.append(f"{_MARGIN} {_PAGE_H - _MARGIN - _HEADER_H + 4} m")
            ops.append(f"{_PAGE_W - _MARGIN} {_PAGE_H - _MARGIN - _HEADER_H + 4} l S")
            ops.append("0 0 0 RG")

        top_y = (_PAGE_H - _MARGIN - _HEADER_H - 10) if first_page else (_PAGE_H - _MARGIN)

        # --- Column header row ---
        y = top_y - _ROW_H
        # header background
        ops.append("0.2 0.3 0.6 rg")
        ops.append(f"{_MARGIN} {y} {usable} {_ROW_H} re f")
        ops.append("1 1 1 rg")  # white text
        x = _MARGIN + 2
        ops.append("BT")
        ops.append(f"/F2 {_FONT_BODY} Tf")
        for ci, h in enumerate(header):
            cw = col_widths[ci] if ci < len(col_widths) else 60
            ops.append(f"{x} {y + 4} Td")
            # truncate header label if too wide (4 pts per char approx)
            label = h[:int(cw / 4.5)] if len(h) * 4.5 > cw else h
            ops.append(_pdf_str(label) + " Tj")
            x += cw
            if ci < len(header) - 1:
                ops.append(f"-{x - _MARGIN - 2} 0 Td")
                x = _MARGIN + 2 + sum(col_widths[:ci+1])
        ops.append("ET")
        ops.append("0 0 0 rg")

        # --- Data rows ---
        alt = False
        for ri, row in enumerate(page_rows):
            y -= _ROW_H
            if alt:
                ops.append("0.96 0.96 0.98 rg")
                ops.append(f"{_MARGIN} {y} {usable} {_ROW_H} re f")
                ops.append("0 0 0 rg")
            alt = not alt

            x = _MARGIN + 2
            ops.append("BT")
            ops.append(f"/F1 {_FONT_BODY} Tf")
            for ci, val in enumerate(row):
                cw = col_widths[ci] if ci < len(col_widths) else 60
                # go to absolute x; use Td relative to previous
                ops.append(f"{x} {y + 4} Td")
                cell = str(val) if val is not None else ""
                cell = cell[:int(cw / 4.5)] if len(cell) * 4.5 > cw else cell
                ops.append(_pdf_str(cell) + " Tj")
                x += cw
                if ci < len(row) - 1:
                    ops.append(f"-{x - _MARGIN - 2} 0 Td")
                    x = _MARGIN + 2 + sum(col_widths[:ci+1])
            ops.append("ET")

            # light row border
            ops.append("0.85 0.85 0.85 RG")
            ops.append(f"{_MARGIN} {y} m {_PAGE_W - _MARGIN} {y} l S")
            ops.append("0 0 0 RG")

        return "\n".join(ops)

    # ------------------------------------------------------------------
    # Paginate rows
    # ------------------------------------------------------------------
    def _rows_per_page(first: bool) -> int:
        available = (_PAGE_H - _MARGIN - _HEADER_H - 10 - _MARGIN) if first else (_PAGE_H - 2 * _MARGIN)
        # subtract col-header row
        available -= _ROW_H
        return max(1, int(available // _ROW_H))

    pages_data: list[tuple[bool, list[list[str]]]] = []
    remaining = [list(r) for r in rows]
    first = True
    while True:
        rpp = _rows_per_page(first)
        batch = remaining[:rpp]
        remaining = remaining[rpp:]
        pages_data.append((first, batch))
        if not remaining:
            break
        first = False

    # ------------------------------------------------------------------
    # Assemble the PDF binary
    # ------------------------------------------------------------------
    ws("%PDF-1.4\n")
    # binary comment so readers don't mis-detect encoding
    w(b"%\xe2\xe3\xcf\xd3\n")

    # We'll collect all object IDs in order: catalog=1, pages=2, font1=3, font2=4,
    # then for each page: page_obj, content_obj pairs starting at 5.
    # Object layout:
    #   1 = catalog
    #   2 = pages (will list page obj ids)
    #   3 = Font F1 (Helvetica)
    #   4 = Font F2 (Helvetica-Bold)
    #   5,6 = page1, content1
    #   7,8 = page2, content2 ...

    n_pages = len(pages_data)
    page_obj_ids = [5 + 2 * i for i in range(n_pages)]       # 5, 7, 9, …
    content_obj_ids = [6 + 2 * i for i in range(n_pages)]    # 6, 8, 10, …

    total_objs = 4 + 2 * n_pages

    # Build all content streams first (we need byte lengths)
    content_streams: list[bytes] = []
    for first_pg, batch in pages_data:
        cs = _page_content(batch, first_pg).encode("latin-1", errors="replace")
        content_streams.append(cs)

    # Write objects
    xref: dict[int, int] = {}

    def obj(oid: int, body: str) -> None:
        xref[oid] = _tell()
        ws(f"{oid} 0 obj\n{body}\nendobj\n")

    # 1 = Catalog
    obj(1, f"<< /Type /Catalog /Pages 2 0 R >>")

    # 2 = Pages
    kids = " ".join(f"{pid} 0 R" for pid in page_obj_ids)
    obj(2, f"<< /Type /Pages /Kids [{kids}] /Count {n_pages} >>")

    # 3 = Font Helvetica (regular)
    obj(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")

    # 4 = Font Helvetica-Bold
    obj(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>")

    # Page + content pairs
    for i, (first_pg, batch) in enumerate(pages_data):
        pid = page_obj_ids[i]
        cid = content_obj_ids[i]
        cs = content_streams[i]

        # Content stream object
        xref[cid] = _tell()
        ws(f"{cid} 0 obj\n<< /Length {len(cs)} >>\nstream\n")
        w(cs)
        ws("\nendstream\nendobj\n")

        # Page object
        obj(pid, (
            f"<< /Type /Page /Parent 2 0 R\n"
            f"   /MediaBox [0 0 {_PAGE_W} {_PAGE_H}]\n"
            f"   /Contents {cid} 0 R\n"
            f"   /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >>\n"
            f">>"
        ))

    # xref table
    xref_offset = _tell()
    ws(f"xref\n0 {total_objs + 1}\n")
    ws("0000000000 65535 f \n")
    for oid in range(1, total_objs + 1):
        ws(f"{xref.get(oid, 0):010d} 00000 n \n")

    ws(f"trailer\n<< /Size {total_objs + 1} /Root 1 0 R >>\n")
    ws(f"startxref\n{xref_offset}\neof\n")
    # Note: case-insensitive EOF marker; some readers want '%%EOF'
    # We also write the standard marker for compatibility
    ws("%%EOF\n")

    return out.getvalue()
