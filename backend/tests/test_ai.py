"""Coverage for the AI-assist foundation (ai.py + routers/ai.py) on the DETERMINISTIC path.

Tests must never call a real LLM. We pin the gateway to the no-provider path (`_active_provider =
"none"`) so every assertion exercises the rule-based / extractive fallback — no network, no hang.
(See the REPORT: this repo's backend/.env actually sets AI_PROVIDER=gemini with a live key, so
without this guard the AI endpoints would hit a real provider.)
"""

import pytest

from app import ai
from app.ai import score_lead, _extract_json


@pytest.fixture(autouse=True)
def _force_deterministic(monkeypatch):
    # pin the completion gateway to the deterministic fallback regardless of env / .env
    monkeypatch.setattr(ai, "_active_provider", "none")


# ===================== score_lead (pure rules) =====================

def test_score_lead_hot_for_strong_signals():
    out = score_lead({"name": "Acme", "phone": "+37410", "email": "a@b.am",
                      "source": "Referral", "status": "assigned"})
    # 30 + 25 + 10 + 25 + 20 = 110 → clamped to 100, band hot (assigned delta = 20)
    assert out["score"] == 100 and out["band"] == "hot"
    assert out["reasons"]                                     # non-empty


def test_score_lead_cold_for_empty():
    out = score_lead({})
    assert out["score"] == 0 and out["band"] == "cold"
    assert out["reasons"] == ["no signals available"]


def test_score_lead_clamped_non_negative():
    out = score_lead({"status": "LOST"})                      # -20 → clamped to 0 (never negative)
    assert out["score"] == 0 and 0 <= out["score"] <= 100


# ===================== _extract_json =====================

def test_extract_json_bare_object():
    assert _extract_json('{"kind":"answer","text":"hi"}') == {"kind": "answer", "text": "hi"}


def test_extract_json_inside_code_fences():
    raw = 'Sure thing!\n```json\n{"a": 1, "b": 2}\n```\n'
    assert _extract_json(raw) == {"a": 1, "b": 2}


def test_extract_json_returns_none_on_junk():
    assert _extract_json("no json here at all") is None
    assert _extract_json("") is None


# ===================== endpoints (deterministic) =====================

async def test_ai_status_is_none_under_test_env(client, admin):
    r = await client.get("/api/ai/status", headers=admin)
    assert r.status_code == 200 and r.json() == {"provider": "none", "live": False}


async def test_ai_ask_returns_nonempty_deterministic_answer(client, admin):
    r = await client.post("/api/ai/ask", headers=admin, json={"question": "How is the business doing?"})
    assert r.status_code == 200
    body = r.json()
    assert body["provider"] == "none"
    assert isinstance(body["answer"], str) and body["answer"].strip()    # grounded readout, no hang


async def test_ai_ask_requires_question(client, admin):
    assert (await client.post("/api/ai/ask", headers=admin, json={"question": "  "})).status_code == 422


async def test_ai_score_lead_endpoint(client, admin):
    r = await client.post("/api/ai/score-lead", headers=admin,
                          json={"fields": {"phone": "x", "email": "y", "source": "Website"}})
    assert r.status_code == 200
    body = r.json()
    assert {"score", "band", "reasons"} <= set(body)
    assert isinstance(body["score"], int) and body["reasons"]


async def test_ai_summarize_endpoint(client, admin):
    r = await client.post("/api/ai/summarize", headers=admin,
                          json={"fields": {"name": "Acme Telecom", "status": "ACTIVE"}})
    assert r.status_code == 200
    assert isinstance(r.json()["summary"], str) and r.json()["summary"].strip()
