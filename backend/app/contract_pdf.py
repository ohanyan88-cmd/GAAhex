"""Contract PDF generation — Unicode (Armenian / Russian / Latin) via reportlab + DejaVu.

The owner will supply the official contract form to store in the DB; until then this
renders a clean contract from the lead's current field values so the Generate →
Download (PDF) flow works with full Armenian support. Swap `build_contract_pdf`'s
layout for the stored template once it's provided.
"""
from __future__ import annotations

import os

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle,
)

_FONT_DIR = os.path.join(os.path.dirname(__file__), "fonts")
_REGULAR, _BOLD = "DejaVu", "DejaVu-Bold"
_fonts_ready = False


def _ensure_fonts() -> None:
    """Register the DejaVu TTFs once (covers Latin + Cyrillic + Armenian)."""
    global _fonts_ready
    if _fonts_ready:
        return
    pdfmetrics.registerFont(TTFont(_REGULAR, os.path.join(_FONT_DIR, "DejaVuSans.ttf")))
    pdfmetrics.registerFont(TTFont(_BOLD, os.path.join(_FONT_DIR, "DejaVuSans-Bold.ttf")))
    pdfmetrics.registerFontFamily(_REGULAR, normal=_REGULAR, bold=_BOLD)
    _fonts_ready = True


def _val(values: dict, key: str) -> str:
    v = values.get(key)
    if v is None or v == "" or isinstance(v, (list, dict)):
        return "—"
    return str(v)


def build_contract_pdf(values: dict, fields: list[dict], date_str: str) -> bytes:
    """Render a contract PDF from lead `values`; `fields` is [{key,label,type}]."""
    _ensure_fonts()
    import io

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=22 * mm, rightMargin=22 * mm, topMargin=20 * mm, bottomMargin=20 * mm,
        title="Service Contract",
    )
    base = getSampleStyleSheet()["Normal"]
    body = ParagraphStyle("body", parent=base, fontName=_REGULAR, fontSize=10, leading=15)
    h1 = ParagraphStyle("h1", parent=body, fontName=_BOLD, fontSize=18, alignment=TA_CENTER, spaceAfter=2)
    sub = ParagraphStyle("sub", parent=body, fontSize=9, textColor=colors.HexColor("#5b6b85"), alignment=TA_CENTER, spaceAfter=16)
    h2 = ParagraphStyle("h2", parent=body, fontName=_BOLD, fontSize=11, textColor=colors.HexColor("#1f3a63"), spaceBefore=12, spaceAfter=6)
    note = ParagraphStyle("note", parent=body, fontSize=8, textColor=colors.HexColor("#8a98ad"), alignment=TA_CENTER, spaceBefore=22)

    full_name = " ".join(
        s for s in (_val(values, "name"), _val(values, "surname"), _val(values, "patronymic")) if s and s != "—"
    ) or "—"

    def kv_table(pairs: list[tuple[str, str]]) -> Table:
        rows = [[Paragraph(k, body), Paragraph(v, body)] for k, v in pairs]
        t = Table(rows, colWidths=[58 * mm, None])
        t.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (-1, -1), _REGULAR),
            ("FONTSIZE", (0, 0), (-1, -1), 10),
            ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#5b6b85")),
            ("LINEBELOW", (0, 0), (-1, -1), 0.4, colors.HexColor("#eef2f7")),
            ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("LEFTPADDING", (0, 0), (-1, -1), 2), ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ]))
        return t

    elems = [
        Paragraph("Service Contract", h1),
        Paragraph(f"HouseNet ISP · {date_str}", sub),
        Paragraph("Subscriber", h2),
        kv_table([("Full name", full_name), ("Phone", _val(values, "phone")), ("Email", _val(values, "email"))]),
        Paragraph("Service &amp; address", h2),
        kv_table([
            ("Region", _val(values, "region")), ("City", _val(values, "city")),
            ("Village", _val(values, "village")), ("Address", _val(values, "address")),
            ("GPS", _val(values, "gps")), ("Service type", _val(values, "service_type")),
            ("Package", _val(values, "package")), ("Contract term", _val(values, "contract_term")),
        ]),
    ]

    detail_pairs = []
    for f in fields:
        if f.get("type") in ("file", "status") or f.get("key") == "attachments":
            continue
        v = _val(values, f.get("key", ""))
        if v and v != "—":
            detail_pairs.append((str(f.get("label", f.get("key", ""))), v))
    if detail_pairs:
        elems += [Paragraph("All details", h2), kv_table(detail_pairs)]

    elems += [Spacer(1, 26 * mm)]
    sign = Table(
        [[Paragraph("Subscriber", sub), Paragraph("HouseNet ISP", sub)]],
        colWidths=[doc.width / 2.0] * 2,
    )
    sign.setStyle(TableStyle([
        ("LINEABOVE", (0, 0), (-1, 0), 0.6, colors.HexColor("#15233b")),
        ("TOPPADDING", (0, 0), (-1, 0), 6),
    ]))
    elems += [sign, Paragraph("Auto-generated draft from the lead form — placeholder template, pending the official contract.", note)]

    doc.build(elems)
    return buf.getvalue()
