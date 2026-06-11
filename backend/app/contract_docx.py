"""Fill the real HouseNet service contract (.docx) with a lead's data and return the bytes.

Dependency-light by design: a .docx is a ZIP of XML, so the fill is pure standard-library
``zipfile`` + string replacement of ``{tag}`` placeholders inside ``word/document.xml``. No
python-docx / docxtemplater needed (the box has no network to install them), and the official
Word formatting / letterhead is preserved exactly — only the placeholder runs change.

The template at ``contract_templates/housenet-ont-template.docx`` was produced from the operator's
own Word file by inserting one ``{tag}`` per blank (see ``tools`` / commit notes). Each tag lives
inside a single ``<w:t>`` run, so a plain string replace is safe and can never split a tag.
"""
from __future__ import annotations

import io
import zipfile
from datetime import datetime
from pathlib import Path

_TEMPLATE = Path(__file__).parent / "contract_templates" / "housenet-ont-template.docx"
_DOC_XML = "word/document.xml"

# Contract placeholder  ->  lead form-field key (the modal posts the lead's form values verbatim).
_FIELD_MAP = {
    "name": "name",
    "address": "address",
    "phone": "phone",
    "passport": "document_number",
    "issued_by": "issued_by",
    "birth": "date_of_birth",
}


def _xml_escape(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def build_contract_docx(values: dict, date_str: str | None = None) -> bytes:
    """Return the official HouseNet contract .docx filled from ``values`` (a lead's form data).

    Unknown / missing fields render as an empty string (the line stays blank, to be hand-filled).
    """
    if date_str is None:
        date_str = datetime.utcnow().strftime("%d.%m.%Y")

    tags = {tag: str(values.get(key) or "") for tag, key in _FIELD_MAP.items()}
    tags["date"] = date_str

    src = _TEMPLATE.read_bytes()
    zin = zipfile.ZipFile(io.BytesIO(src))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == _DOC_XML:
                xml = data.decode("utf-8")
                for tag, val in tags.items():
                    xml = xml.replace("{" + tag + "}", _xml_escape(val))
                data = xml.encode("utf-8")
            zout.writestr(item, data)
    return out.getvalue()
