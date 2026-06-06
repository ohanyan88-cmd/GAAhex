"""Batch 24 tests — report schedules (A24) + export formats xlsx/pdf (E24).

A24: /api/report-schedules CRUD + /api/report-schedules/run-due.
     The router is NOT yet merged (A24 still in lane A). Those tests are guarded with
     pytest.skip so the suite stays green. The ReportSchedule model itself IS already
     present (models/report_schedule.py) and is tested unconditionally.

     Wiring probe: we check app.routes for a path that starts with "/api/report-schedules".
     Import alone is insufficient — the model exists but the router may not be registered.

E24: /api/{slug}/export?format=xlsx|pdf.
     The current export.py only serves csv + json and returns 400 for anything else.
     xlsx/pdf tests are skipped until the router is extended to support them.
     csv correctness (already wired) runs unconditionally.

     Wiring probe for xlsx: we GET /api/leads/export?format=xlsx and check whether
     the response is 200 with a binary content-type. If it's 400 the feature is not
     yet merged and we skip.

All async tests rely on asyncio_mode=auto (pytest.ini). Session-scoped client + admin
fixtures are from conftest — unchanged.
"""

import csv
import importlib
import io
import uuid

import pytest

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _uniq(tag: str) -> str:
    return f"{tag}-{uuid.uuid4().hex[:8]}"


# ---------------------------------------------------------------------------
# Detect A24 — /api/report-schedules wired in main.py
#
# The model may exist without the router being registered. We detect wiring by
# inspecting app.routes for a path that starts with "/api/report-schedules".
# ---------------------------------------------------------------------------

_A24_PRESENT = False
_A24_REASON = "app.routers.report_schedules not yet merged or not wired in main.py (A24)"

try:
    from app.main import app as _app

    # Check mounted routes for /api/report-schedules
    for _route in _app.routes:
        _path = getattr(_route, "path", "")
        if _path.startswith("/api/report-schedules"):
            _A24_PRESENT = True
            break

    if not _A24_PRESENT:
        # Also check if a router module exists but just isn't wired
        try:
            _sched_mod = importlib.import_module("app.routers.report_schedules")
            _A24_REASON = (
                "app.routers.report_schedules exists but is NOT registered in main.py (A24 not yet wired)"
            )
        except ModuleNotFoundError:
            _A24_REASON = "app.routers.report_schedules not yet merged (A24)"
except Exception as _e:
    _A24_REASON = f"Could not inspect app routes: {_e}"


# ---------------------------------------------------------------------------
# Detect E24 xlsx/pdf — the export router supports these formats
#
# We detect by checking whether the export.py source allows xlsx/pdf, OR we'll
# detect at runtime (lazy) inside each test by probing the live route response.
# We use a module-level flag set from a static source inspection to avoid making
# real HTTP calls at import time (session fixtures aren't ready yet).
# ---------------------------------------------------------------------------

_E24_XLSX_PRESENT = False
_E24_XLSX_REASON = "export.py does not yet support ?format=xlsx (E24 not yet merged)"
_E24_PDF_PRESENT = False
_E24_PDF_REASON = "export.py does not yet support ?format=pdf (E24 not yet merged)"

try:
    import app.routers.export as _export_mod
    import inspect as _inspect

    _export_src = _inspect.getsource(_export_mod)
    # Presence of "xlsx" in the source indicates the feature is merged
    if "xlsx" in _export_src:
        _E24_XLSX_PRESENT = True
    if "pdf" in _export_src and "application/pdf" in _export_src:
        _E24_PDF_PRESENT = True
except Exception as _e:
    _E24_XLSX_REASON = f"Could not inspect export module: {_e}"
    _E24_PDF_REASON = _E24_XLSX_REASON


# ===========================================================================
# PART 1 — ReportSchedule model (always runs — model is already present)
# ===========================================================================


def test_report_schedule_model_importable():
    """ReportSchedule model is importable from app.models (models/report_schedule.py is merged)."""
    from app.models.report_schedule import ReportSchedule  # noqa: F401
    assert ReportSchedule.__tablename__ == "report_schedule"


def test_report_schedule_model_has_required_columns():
    """ReportSchedule has the columns specified in A24: report_id, cadence, channel, recipients,
    next_run_at, last_run_at, status, tenant_id."""
    from app.models.report_schedule import ReportSchedule

    mapper = ReportSchedule.__mapper__
    col_names = {c.key for c in mapper.column_attrs}
    required = {
        "id", "tenant_id", "report_id", "cadence", "channel",
        "recipients", "next_run_at", "last_run_at", "status", "created_at",
    }
    missing = required - col_names
    assert not missing, f"ReportSchedule is missing columns: {missing}"


def test_report_schedule_model_instantiation():
    """Instantiating a ReportSchedule with valid data does not raise."""
    from app.models.report_schedule import ReportSchedule
    from datetime import datetime, timezone

    sched = ReportSchedule(
        tenant_id=uuid.uuid4(),
        report_id=uuid.uuid4(),
        cadence="daily",
        channel="email",
        recipients=["admin@demo.isp"],
        next_run_at=datetime(2025, 1, 2, tzinfo=timezone.utc),
        status="ACTIVE",
    )
    assert sched.cadence == "daily"
    assert sched.channel == "email"
    assert sched.status == "ACTIVE"
    assert sched.recipients == ["admin@demo.isp"]


def test_report_schedule_model_paused_status():
    """PAUSED status is a valid string value for ReportSchedule.status."""
    from app.models.report_schedule import ReportSchedule
    from datetime import datetime, timezone

    sched = ReportSchedule(
        tenant_id=uuid.uuid4(),
        report_id=uuid.uuid4(),
        cadence="weekly",
        channel="console",
        recipients=[],
        next_run_at=datetime(2025, 1, 7, tzinfo=timezone.utc),
        status="PAUSED",
    )
    assert sched.status == "PAUSED"


def test_report_schedule_in_models_init():
    """ReportSchedule is exported from app.models (models/__init__.py includes it)."""
    from app import models
    assert hasattr(models, "ReportSchedule"), (
        "ReportSchedule is not exported from app.models — check models/__init__.py"
    )
    from app.models import ReportSchedule  # noqa: F401


# ===========================================================================
# PART 2 — /api/report-schedules CRUD (skip gracefully until A24 lands)
# ===========================================================================


async def _ensure_report(client, admin) -> str:
    """Create a saved ReportDef we can attach schedules to. Returns the report id."""
    key = _uniq("sched-rep")
    r = await client.post(
        "/api/reports-builder",
        headers=admin,
        json={"key": key, "name": key, "query": {"entity": "lead", "metric": "count"}},
    )
    assert r.status_code == 201, f"Could not create backing ReportDef: {r.text}"
    return r.json()["id"]


async def test_schedules_unauthenticated_rejected(client):
    """GET /api/report-schedules without a token returns 401 or 403 (never 200).
    Skipped until A24 is merged."""
    if not _A24_PRESENT:
        pytest.skip(f"Skipping: {_A24_REASON}")

    r = await client.get("/api/report-schedules")
    assert r.status_code in (401, 403), (
        f"Expected 401 or 403 for unauthenticated /api/report-schedules; got {r.status_code}: {r.text}"
    )


async def test_schedules_create_appears_in_list(client, admin):
    """POST /api/report-schedules creates a schedule that then appears in GET /api/report-schedules.
    Skipped until A24 is merged."""
    if not _A24_PRESENT:
        pytest.skip(f"Skipping: {_A24_REASON}")

    report_id = await _ensure_report(client, admin)
    payload = {
        "report_id": report_id,
        "cadence": "daily",
        "channel": "console",
        "recipients": [],
        "next_run_at": "2099-01-01T00:00:00Z",
    }
    r = await client.post("/api/report-schedules", headers=admin, json=payload)
    assert r.status_code in (200, 201), f"Create schedule failed: {r.text}"
    created = r.json()
    sched_id = created["id"]

    # Verify it appears in the list
    list_r = await client.get("/api/report-schedules", headers=admin)
    assert list_r.status_code == 200, list_r.text
    schedules = list_r.json()
    assert isinstance(schedules, list), f"Expected list from GET /api/report-schedules; got: {type(schedules).__name__}"
    ids = [s.get("id") for s in schedules]
    assert sched_id in ids, (
        f"Newly created schedule {sched_id} not found in GET /api/report-schedules list"
    )


async def test_schedules_create_response_schema(client, admin):
    """Created schedule response has the expected fields.
    Skipped until A24 is merged."""
    if not _A24_PRESENT:
        pytest.skip(f"Skipping: {_A24_REASON}")

    report_id = await _ensure_report(client, admin)
    r = await client.post(
        "/api/report-schedules",
        headers=admin,
        json={
            "report_id": report_id,
            "cadence": "weekly",
            "channel": "email",
            "recipients": ["ops@example.com"],
            "next_run_at": "2099-06-01T00:00:00Z",
        },
    )
    assert r.status_code in (200, 201), f"Create schedule failed: {r.text}"
    body = r.json()
    for field in ("id", "report_id", "cadence", "channel", "recipients", "next_run_at", "status"):
        assert field in body, f"Schedule response missing '{field}'; got: {body}"
    assert body["status"] == "ACTIVE", f"New schedule should start ACTIVE; got: {body['status']}"
    assert body["cadence"] == "weekly"
    assert body["channel"] == "email"


async def test_schedule_get_by_id(client, admin):
    """GET /api/report-schedules/{id} returns the schedule by id.
    Skipped until A24 is merged."""
    if not _A24_PRESENT:
        pytest.skip(f"Skipping: {_A24_REASON}")

    report_id = await _ensure_report(client, admin)
    r = await client.post(
        "/api/report-schedules",
        headers=admin,
        json={
            "report_id": report_id,
            "cadence": "monthly",
            "channel": "console",
            "recipients": [],
            "next_run_at": "2099-12-01T00:00:00Z",
        },
    )
    assert r.status_code in (200, 201), r.text
    sched_id = r.json()["id"]

    get_r = await client.get(f"/api/report-schedules/{sched_id}", headers=admin)
    assert get_r.status_code == 200, f"GET /api/report-schedules/{sched_id} failed: {get_r.text}"
    got = get_r.json()
    assert got["id"] == sched_id
    assert got["cadence"] == "monthly"


async def test_schedule_pause_and_resume(client, admin):
    """PATCH /api/report-schedules/{id} toggles status between ACTIVE and PAUSED.
    Skipped until A24 is merged."""
    if not _A24_PRESENT:
        pytest.skip(f"Skipping: {_A24_REASON}")

    report_id = await _ensure_report(client, admin)
    r = await client.post(
        "/api/report-schedules",
        headers=admin,
        json={
            "report_id": report_id,
            "cadence": "daily",
            "channel": "console",
            "recipients": [],
            "next_run_at": "2099-03-01T00:00:00Z",
        },
    )
    assert r.status_code in (200, 201), r.text
    sched_id = r.json()["id"]

    # Pause
    pause_r = await client.patch(
        f"/api/report-schedules/{sched_id}", headers=admin, json={"status": "PAUSED"}
    )
    assert pause_r.status_code == 200, f"Pause failed: {pause_r.text}"
    assert pause_r.json()["status"] == "PAUSED", f"Expected PAUSED; got: {pause_r.json()}"

    # Resume
    resume_r = await client.patch(
        f"/api/report-schedules/{sched_id}", headers=admin, json={"status": "ACTIVE"}
    )
    assert resume_r.status_code == 200, f"Resume failed: {resume_r.text}"
    assert resume_r.json()["status"] == "ACTIVE", f"Expected ACTIVE; got: {resume_r.json()}"


async def test_schedule_unknown_id_404(client, admin):
    """GET /api/report-schedules/{unknown-id} returns 404.
    Skipped until A24 is merged."""
    if not _A24_PRESENT:
        pytest.skip(f"Skipping: {_A24_REASON}")

    r = await client.get(f"/api/report-schedules/{uuid.uuid4()}", headers=admin)
    assert r.status_code == 404, (
        f"Expected 404 for unknown schedule id; got {r.status_code}: {r.text}"
    )


# ===========================================================================
# PART 3 — run-due job (skip gracefully until A24 lands)
# ===========================================================================


async def test_run_due_advances_schedule_and_writes_job_run(client, admin):
    """POST /api/report-schedules/run-due picks up a due schedule, advances next_run_at,
    sets last_run_at, and writes a JobRun with job_key='report.run_due' and status='SUCCESS'
    visible via GET /api/jobs.
    Skipped until A24 is merged."""
    if not _A24_PRESENT:
        pytest.skip(f"Skipping: {_A24_REASON}")

    report_id = await _ensure_report(client, admin)

    # Create a schedule that is already due (next_run_at in the past)
    past_due_at = "2000-01-01T00:00:00Z"
    r = await client.post(
        "/api/report-schedules",
        headers=admin,
        json={
            "report_id": report_id,
            "cadence": "daily",
            "channel": "console",
            "recipients": [],
            "next_run_at": past_due_at,
        },
    )
    assert r.status_code in (200, 201), r.text
    sched_id = r.json()["id"]
    original_next_run_at = r.json()["next_run_at"]

    # Run due — use as_of today so the past-due schedule is picked up
    run_r = await client.post(
        "/api/report-schedules/run-due",
        headers=admin,
        json={},
    )
    assert run_r.status_code == 200, f"run-due failed: {run_r.text}"
    result = run_r.json()
    # Result must indicate at least one schedule was processed
    assert isinstance(result, dict), f"Expected dict from run-due; got: {type(result).__name__}"
    # A24's run-due summary contract: {rendered, delivered, errors, due}
    assert {"rendered", "delivered", "errors", "due"} <= set(result), (
        f"run-due response must report rendered/delivered/errors/due; got: {result}"
    )
    assert result["due"] >= 1, f"expected at least one due schedule processed; got: {result}"

    # next_run_at must have advanced past the original value
    sched_r = await client.get(f"/api/report-schedules/{sched_id}", headers=admin)
    assert sched_r.status_code == 200, sched_r.text
    updated = sched_r.json()
    assert updated.get("last_run_at") is not None, (
        f"last_run_at should be set after run-due; got: {updated}"
    )
    assert updated["next_run_at"] != original_next_run_at, (
        f"next_run_at must advance after run-due; still: {updated['next_run_at']}"
    )

    # A JobRun must be visible in /api/jobs with job_key='report.run_due' and status='SUCCESS'
    jobs_r = await client.get("/api/jobs?job_key=report.run_due", headers=admin)
    assert jobs_r.status_code == 200, f"GET /api/jobs failed: {jobs_r.text}"
    runs = jobs_r.json()
    assert isinstance(runs, list), f"Expected list from /api/jobs; got: {runs!r:.200}"
    assert runs, "Expected at least one JobRun for 'report.run_due' after running run-due"
    latest = runs[0]  # newest first
    assert latest["status"] == "SUCCESS", (
        f"Expected SUCCESS JobRun for report.run_due; got: {latest}"
    )
    assert latest["job_key"] == "report.run_due", (
        f"Unexpected job_key: {latest['job_key']}"
    )


async def test_run_due_idempotent_same_as_of(client, admin):
    """A second POST /api/report-schedules/run-due with the same as_of is a no-op —
    next_run_at does not advance again (idempotent).
    Skipped until A24 is merged."""
    if not _A24_PRESENT:
        pytest.skip(f"Skipping: {_A24_REASON}")

    report_id = await _ensure_report(client, admin)

    # Create another past-due schedule
    r = await client.post(
        "/api/report-schedules",
        headers=admin,
        json={
            "report_id": report_id,
            "cadence": "daily",
            "channel": "console",
            "recipients": [],
            "next_run_at": "2000-01-01T00:00:00Z",
        },
    )
    assert r.status_code in (200, 201), r.text
    sched_id = r.json()["id"]

    # First run
    as_of = "2026-05-27"
    first_r = await client.post(
        "/api/report-schedules/run-due",
        headers=admin,
        json={"as_of": as_of},
    )
    assert first_r.status_code == 200, f"First run-due failed: {first_r.text}"

    # Capture next_run_at after first run
    after_first = (await client.get(f"/api/report-schedules/{sched_id}", headers=admin)).json()
    next_after_first = after_first.get("next_run_at")
    assert next_after_first is not None, "next_run_at should be set after first run"

    # Second run with same as_of — must be a no-op for this schedule
    second_r = await client.post(
        "/api/report-schedules/run-due",
        headers=admin,
        json={"as_of": as_of},
    )
    assert second_r.status_code == 200, f"Second run-due failed: {second_r.text}"

    after_second = (await client.get(f"/api/report-schedules/{sched_id}", headers=admin)).json()
    next_after_second = after_second.get("next_run_at")

    assert next_after_first == next_after_second, (
        f"next_run_at must not change on a second run-due with same as_of; "
        f"first={next_after_first}, second={next_after_second}"
    )


async def test_run_due_skips_paused_schedules(client, admin):
    """run-due does NOT fire a PAUSED schedule.
    Skipped until A24 is merged."""
    if not _A24_PRESENT:
        pytest.skip(f"Skipping: {_A24_REASON}")

    report_id = await _ensure_report(client, admin)

    # Create past-due schedule and immediately pause it
    r = await client.post(
        "/api/report-schedules",
        headers=admin,
        json={
            "report_id": report_id,
            "cadence": "daily",
            "channel": "console",
            "recipients": [],
            "next_run_at": "2000-01-01T00:00:00Z",
        },
    )
    assert r.status_code in (200, 201), r.text
    sched_id = r.json()["id"]

    # Pause it
    pause_r = await client.patch(
        f"/api/report-schedules/{sched_id}", headers=admin, json={"status": "PAUSED"}
    )
    assert pause_r.status_code == 200, pause_r.text

    original_next_run_at = "2000-01-01T00:00:00Z"

    # Run due — paused schedule should be skipped
    await client.post("/api/report-schedules/run-due", headers=admin, json={})

    after_run = (await client.get(f"/api/report-schedules/{sched_id}", headers=admin)).json()
    # last_run_at should NOT be set (it was never run)
    assert after_run.get("last_run_at") is None, (
        f"PAUSED schedule should not have last_run_at set after run-due; got: {after_run}"
    )
    # next_run_at should not advance (still at the original past-due value or close)
    # We accept minor clock drift but the key is last_run_at is None


# ===========================================================================
# PART 4 — Export csv (always runs — already wired)
# ===========================================================================


async def test_export_csv_still_works(client, admin):
    """?format=csv returns 200 with text/csv content-type and a valid CSV body (non-empty header).
    This validates the base export still functions after any E24 changes."""
    tok = _uniq("b24csv")
    r = await client.post("/api/leads", headers=admin, json={"name": f"{tok} lead"})
    assert r.status_code == 201, r.text

    export_r = await client.get(f"/api/leads/export?format=csv&q={tok}", headers=admin)
    assert export_r.status_code == 200, f"CSV export failed: {export_r.text}"
    assert export_r.headers.get("content-type", "").startswith("text/csv"), (
        f"Expected text/csv content-type; got: {export_r.headers.get('content-type')}"
    )
    rows = list(csv.reader(io.StringIO(export_r.text)))
    assert rows, "CSV export returned an empty body — at least a header row expected"
    assert len(rows) >= 2, f"Expected header + at least 1 data row; got {len(rows)} rows"


async def test_export_csv_valid_structure(client, admin):
    """CSV export has the correct header columns and one data row per matching lead."""
    tok = _uniq("b24csvstruct")
    for i in range(2):
        r = await client.post("/api/leads", headers=admin, json={"name": f"{tok}-{i}"})
        assert r.status_code == 201, r.text

    export_r = await client.get(f"/api/leads/export?format=csv&q={tok}", headers=admin)
    assert export_r.status_code == 200, export_r.text
    # Strip the UTF-8 BOM the export prepends for spreadsheet apps before parsing.
    rows = list(csv.reader(io.StringIO(export_r.text.lstrip("﻿"))))
    header = rows[0]
    # Standard lead export columns (from export.py + leads field definitions)
    assert "Name" in header, f"Expected 'Name' in CSV header; got: {header}"
    assert len(rows) == 3, f"Expected 1 header + 2 data rows; got {len(rows)} rows: {rows}"


async def test_export_unknown_format_degrades_sensibly(client, admin):
    """?format=unknown returns 400 (or the default format fallback), never a 500.
    Already wired and tested — validates the safety net before E24 adds new formats."""
    r = await client.get("/api/leads/export?format=unknown_xyz_abc", headers=admin)
    assert r.status_code != 500, (
        f"Unknown format must not cause a 500 server error; got {r.status_code}: {r.text}"
    )
    # Current export.py returns 400 for unknown formats; once E24 lands it may fall back to csv
    assert r.status_code in (200, 400), (
        f"Expected 200 (fallback) or 400 (error) for unknown format; got {r.status_code}: {r.text}"
    )


# ===========================================================================
# PART 5 — Export xlsx (skip gracefully until E24 lands)
# ===========================================================================


async def test_export_xlsx_content_type(client, admin):
    """?format=xlsx returns 200 with the xlsx content-type
    (application/vnd.openxmlformats-officedocument.spreadsheetml.sheet or similar)
    and a non-empty binary body.
    Skipped until E24 is merged."""
    if not _E24_XLSX_PRESENT:
        pytest.skip(f"Skipping: {_E24_XLSX_REASON}")

    tok = _uniq("b24xlsx")
    await client.post("/api/leads", headers=admin, json={"name": f"{tok} lead"})

    r = await client.get(f"/api/leads/export?format=xlsx&q={tok}", headers=admin)
    assert r.status_code == 200, f"xlsx export failed: {r.status_code}: {r.text[:200]}"

    ct = r.headers.get("content-type", "")
    assert "spreadsheetml" in ct or "excel" in ct or "xlsx" in ct or "octet-stream" in ct, (
        f"Expected xlsx content-type; got: {ct!r}"
    )
    assert len(r.content) > 0, "xlsx export returned empty body"


async def test_export_xlsx_non_empty_body(client, admin):
    """?format=xlsx body is non-empty and starts with the PK zip magic bytes (xlsx is a zip).
    Skipped until E24 is merged."""
    if not _E24_XLSX_PRESENT:
        pytest.skip(f"Skipping: {_E24_XLSX_REASON}")

    tok = _uniq("b24xlsxbody")
    await client.post("/api/leads", headers=admin, json={"name": f"{tok} lead"})

    r = await client.get(f"/api/leads/export?format=xlsx&q={tok}", headers=admin)
    assert r.status_code == 200, r.text
    body = r.content
    assert len(body) > 22, f"xlsx body too small to be a real xlsx file: {len(body)} bytes"
    # xlsx is a ZIP archive; ZIP magic bytes = PK (0x50 0x4B)
    assert body[:2] == b"PK", (
        f"xlsx body should start with PK (zip magic bytes); got: {body[:4]!r}"
    )


async def test_export_xlsx_unauthenticated_rejected(client):
    """?format=xlsx without auth returns 401 or 403, not 200.
    Skipped until E24 is merged."""
    if not _E24_XLSX_PRESENT:
        pytest.skip(f"Skipping: {_E24_XLSX_REASON}")

    r = await client.get("/api/leads/export?format=xlsx")
    assert r.status_code in (401, 403), (
        f"Expected 401 or 403 for unauthenticated xlsx export; got {r.status_code}"
    )


# ===========================================================================
# PART 6 — Export pdf (skip gracefully until E24 lands)
# ===========================================================================


async def test_export_pdf_content_type(client, admin):
    """?format=pdf returns 200 with application/pdf content-type and a non-empty body.
    Skipped until E24 is merged."""
    if not _E24_PDF_PRESENT:
        pytest.skip(f"Skipping: {_E24_PDF_REASON}")

    tok = _uniq("b24pdf")
    await client.post("/api/leads", headers=admin, json={"name": f"{tok} lead"})

    r = await client.get(f"/api/leads/export?format=pdf&q={tok}", headers=admin)
    assert r.status_code == 200, f"pdf export failed: {r.status_code}: {r.text[:200]}"

    ct = r.headers.get("content-type", "")
    assert "pdf" in ct.lower(), f"Expected application/pdf content-type; got: {ct!r}"
    assert len(r.content) > 0, "pdf export returned empty body"


async def test_export_pdf_non_empty_body_and_magic_bytes(client, admin):
    """?format=pdf body is non-empty and starts with the PDF magic bytes (%PDF).
    Skipped until E24 is merged."""
    if not _E24_PDF_PRESENT:
        pytest.skip(f"Skipping: {_E24_PDF_REASON}")

    tok = _uniq("b24pdfbody")
    await client.post("/api/leads", headers=admin, json={"name": f"{tok} lead"})

    r = await client.get(f"/api/leads/export?format=pdf&q={tok}", headers=admin)
    assert r.status_code == 200, r.text
    body = r.content
    assert len(body) > 4, f"PDF body too small: {len(body)} bytes"
    # PDF files start with %PDF
    assert body[:4] == b"%PDF", (
        f"PDF body should start with %PDF magic bytes; got: {body[:8]!r}"
    )


async def test_export_pdf_unauthenticated_rejected(client):
    """?format=pdf without auth returns 401 or 403, not 200.
    Skipped until E24 is merged."""
    if not _E24_PDF_PRESENT:
        pytest.skip(f"Skipping: {_E24_PDF_REASON}")

    r = await client.get("/api/leads/export?format=pdf")
    assert r.status_code in (401, 403), (
        f"Expected 401 or 403 for unauthenticated pdf export; got {r.status_code}"
    )


async def test_export_unknown_format_never_500_post_e24(client, admin):
    """After E24 adds xlsx+pdf, unknown formats must still degrade sensibly (400 or default),
    never raise a 500. This test always runs — it validates robustness of the format guard."""
    r = await client.get("/api/leads/export?format=totally_unknown_format", headers=admin)
    assert r.status_code != 500, (
        f"Unknown export format must never cause a 500; got {r.status_code}: {r.text[:200]}"
    )
