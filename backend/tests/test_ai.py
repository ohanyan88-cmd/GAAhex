"""Coverage for the AI-assist foundation (ai.py + routers/ai.py) on the DETERMINISTIC path.

Tests must never call a real LLM. We pin the gateway to the no-provider path (`_active_provider =
"none"`) so every assertion exercises the rule-based / extractive fallback — no network, no hang.
This guard holds even if a developer sets a live provider in their gitignored backend/.env: the
shipped default has AI OFF (`ai_provider` defaults to "none"). The REAL provider path is still
validated end-to-end below via a mocked transport (no network, no key) so enablement is proven.
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
                      "source": "Referral", "status": "ASSIGNED"})
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


# ===================== REAL provider path (mocked transport — no network, no key) =====================
# Validates that the moment a provider is configured (e.g. Gemini free tier on a demo org), the
# gateway leaves the deterministic stub and round-trips a real chat-completions call correctly —
# proven here deterministically so enablement is validated BEFORE any live key is dropped in .env.

class _FakeResp:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class _FakeClient:
    """Minimal async-context httpx stand-in: captures the outbound request, returns a canned body."""
    def __init__(self, payload, capture):
        self._payload = payload
        self._capture = capture

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, headers=None, json=None):
        self._capture.update(url=url, headers=headers, json=json)
        return _FakeResp(self._payload)


async def test_openai_compatible_path_calls_and_parses(monkeypatch):
    """OpenAI-compatible (gemini/openai/groq) path: configure a provider, mock the transport, and
    assert complete() POSTs an OpenAI-shaped chat request and returns the model's content — NOT the
    deterministic stub."""
    import app.utils.http_client as hc
    capture: dict = {}
    payload = {"choices": [{"message": {"content": "MODEL SAYS HI"}}]}
    monkeypatch.setattr(hc, "get_async_client", lambda **kw: _FakeClient(payload, capture))
    monkeypatch.setattr(ai.settings, "ai_provider", "gemini")
    monkeypatch.setattr(ai.settings, "ai_api_key", "test-key")
    monkeypatch.setattr(ai.settings, "ai_model", None)
    monkeypatch.setattr(ai.settings, "ai_base_url", None)
    ai.configure_ai()                       # activates gemini deterministically (independent of .env)
    try:
        assert ai.active_provider() == "gemini"
        out = await ai.complete("Summarize: foo", system="be brief")
        assert out == "MODEL SAYS HI"                                   # real content, not the stub
        assert capture["url"].endswith("/chat/completions")
        assert capture["headers"]["Authorization"] == "Bearer test-key"
        assert capture["json"]["messages"][0] == {"role": "system", "content": "be brief"}
        assert capture["json"]["messages"][-1]["content"] == "Summarize: foo"
    finally:
        ai._active_provider = "none"                                    # don't leak into other tests


async def test_provider_error_falls_back_to_stub(monkeypatch):
    """Fail-soft: a configured provider that RAISES must fall back to the deterministic stub and
    never propagate the error to the caller."""
    async def _boom(prompt, system):
        raise RuntimeError("provider down")

    monkeypatch.setitem(ai._PROVIDERS, "boom", _boom)
    monkeypatch.setattr(ai, "_active_provider", "boom")
    out = await ai.complete("- a: 1\n- b: 2")
    assert out.startswith("Summary —")                                 # extractive stub, no exception
