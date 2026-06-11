import io
import zipfile

import pytest


@pytest.mark.asyncio
async def test_contract_docx_fills_and_returns_valid_docx(client, admin):
    values = {
        "name": "Գևորգ Օհանյան",
        "address": "ք. Արմավիր, Հանրապետության 12",
        "phone": "+374 93 75 44 99",
        "document_number": "AN1234567",
        "issued_by": "Ոստիկանություն 001",
        "date_of_birth": "12.05.1988",
    }
    r = await client.post("/api/leads/contract-docx", json={"values": values}, headers=admin)
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    # valid zip / docx, placeholders all filled, values present in document.xml
    xml = zipfile.ZipFile(io.BytesIO(r.content)).read("word/document.xml").decode("utf-8")
    assert "{" not in xml or "}" not in xml or "{name}" not in xml
    for needle in ("Գևորգ Օհանյան", "AN1234567", "12.05.1988"):
        assert needle in xml, f"missing {needle}"
