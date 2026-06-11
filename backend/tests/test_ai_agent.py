"""Safety-critical coverage for the propose → confirm → execute agent (routers/ai.py).

The invariants that keep the LLM out of the write path:
  - With no provider the agent NEVER proposes (chat is read-only / answer-only).
  - `_validate_action` is the server-side allowlist, re-checked on every action — the model's
    proposal is never trusted; bad/unknown actions → 422.
  - `/act` runs CONFIRMED actions through the SAME records engine as the UI, so the caller's
    permissions / scope / audit apply (the AI gets no special privilege).
Provider pinned to "none" (deterministic); no real LLM is ever called.
"""

import uuid

import pytest
from fastapi import HTTPException

from app import ai
from app.routers.ai import _validate_action


@pytest.fixture(autouse=True)
def _force_deterministic(monkeypatch):
    monkeypatch.setattr(ai, "_active_provider", "none")


# ===================== chat never proposes without a provider =====================

async def test_chat_only_answers_without_provider(client, admin):
    # an explicit "create" intent must still come back as an ANSWER (no provider ⇒ no proposal)
    r = await client.post("/api/ai/chat", headers=admin, json={"question": "Create a lead named Globex"})
    assert r.status_code == 200
    body = r.json()
    assert body["kind"] == "answer" and body["provider"] == "none"


# ===================== _validate_action allowlist (unit) =====================

def test_validate_create_lead_requires_name():
    with pytest.raises(HTTPException) as ei:
        _validate_action("create_lead", {})
    assert ei.value.status_code == 422


def test_validate_create_lead_drops_unknown_keeps_valid_source():
    # an unknown source is dropped (not trusted); valid fields are kept + trimmed
    _, clean = _validate_action("create_lead", {"name": "A", "source": "Mars Bazaar", "phone": "5"})
    assert "source" not in clean and clean["name"] == "A" and clean["phone"] == "5"
    _, clean2 = _validate_action("create_lead", {"name": "B", "source": "Referral"})
    assert clean2["source"] == "Referral"


def test_validate_move_lead_requires_name_and_valid_status():
    action, clean = _validate_action("move_lead", {"lead_name": "A", "to_status": "Assigned"})
    assert action == "move_lead" and clean == {"lead_name": "A", "to_status": "assigned"}   # normalized lower (SST keys)
    with pytest.raises(HTTPException) as e1:
        _validate_action("move_lead", {"to_status": "assigned"})            # missing lead_name
    assert e1.value.status_code == 422
    with pytest.raises(HTTPException) as e2:
        _validate_action("move_lead", {"lead_name": "A", "to_status": "WAT"})  # invalid status
    assert e2.value.status_code == 422


def test_validate_unknown_action():
    with pytest.raises(HTTPException) as ei:
        _validate_action("drop_table", {"name": "x"})
    assert ei.value.status_code == 422


# ===================== /act executes through the records engine =====================

async def test_act_create_lead_appears_in_leads(client, admin):
    tag = uuid.uuid4().hex[:8]
    name = f"QA Lead {tag}"
    r = await client.post("/api/ai/act", headers=admin,
                          json={"action": "create_lead", "args": {"name": name, "source": "Website"}})
    assert r.status_code == 200 and r.json()["ok"] is True
    # the lead is real — it shows up through the normal, permission-checked records list endpoint
    leads = (await client.get(f"/api/leads?q={tag}", headers=admin)).json()
    assert any(l.get("name") == name for l in leads)


async def test_act_move_nonexistent_lead_404(client, admin):
    r = await client.post("/api/ai/act", headers=admin, json={
        "action": "move_lead",
        "args": {"lead_name": f"Ghost {uuid.uuid4().hex}", "to_status": "assigned"}})
    assert r.status_code == 404
