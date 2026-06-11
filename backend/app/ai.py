"""AI-assist foundation (provider-agnostic, opt-in, dormant-safe).

Mirrors the channel-adapter discipline (channels.py): a small provider registry + `configure_ai()`
that activates a real LLM ONLY when env-configured. With no provider (`AI_PROVIDER=none`, the
default), every capability still returns a useful DETERMINISTIC result — never an error, never a
hang — so the test suite and fresh clones are unaffected. Real providers are called via httpx
(already a dep, lazily imported); secrets come from gitignored backend/.env only.

Capabilities:
  - score_lead(fields)       — pure rule-based lead score (always on, no external call).
  - summarize_record(fields) — builds a prompt and calls complete(); templated today, real LLM the
                               day a key is set, with NO caller change.

Configure via backend/.env:
  AI_PROVIDER=openai     AI_API_KEY=sk-...   AI_MODEL=gpt-4o-mini             [AI_BASE_URL=...]
  AI_PROVIDER=anthropic  AI_API_KEY=sk-ant-...  AI_MODEL=claude-3-5-haiku-latest
"""
import logging
from typing import Awaitable, Callable

from .config import settings

logger = logging.getLogger("gaahex.ai")

# A provider impl: async (prompt, system) -> text. It RAISES on failure; the gateway catches and
# falls back to the deterministic stub, so callers always get text.
CompletionFn = Callable[[str, str | None], Awaitable[str]]

_PROVIDERS: dict[str, CompletionFn] = {}
_active_provider: str = "none"


def register_provider(name: str, fn: CompletionFn) -> None:
    _PROVIDERS[name] = fn


def active_provider() -> str:
    return _active_provider


# ---- deterministic fallback (the "none" provider) ----

def _deterministic_stub(prompt: str, system: str | None) -> str:
    """Extractive, dependency-free text. Pulls "- key: value" fact lines out of the prompt into a
    compact sentence; otherwise returns a trimmed echo. Always non-empty."""
    facts = [ln.strip()[1:].strip() for ln in prompt.splitlines() if ln.strip().startswith("-")]
    if facts:
        return "Summary — " + "; ".join(facts) + "."
    text = " ".join(prompt.split())
    return text[:280] if text else "No content to summarize."


# ---- real providers (registered only when configured) ----

# OpenAI-compatible providers: same chat/completions wire format, different base URL + default model.
# Gemini and Groq both expose this surface, so one client covers openai / gemini / groq.
_OPENAI_COMPAT = {
    "openai": ("https://api.openai.com/v1", "gpt-4o-mini"),
    "gemini": ("https://generativelanguage.googleapis.com/v1beta/openai", "gemini-flash-latest"),
    "groq":   ("https://api.groq.com/openai/v1", "llama-3.3-70b-versatile"),
}


def _openai_compatible(provider: str) -> CompletionFn:
    """Build a completion fn for any OpenAI-compatible provider (openai/gemini/groq)."""
    default_base, default_model = _OPENAI_COMPAT[provider]

    async def _complete(prompt: str, system: str | None) -> str:
        from .utils.http_client import get_async_client  # AC-5 — canonical factory
        base = settings.ai_base_url or default_base
        model = settings.ai_model or default_model
        messages = ([{"role": "system", "content": system}] if system else []) + \
                   [{"role": "user", "content": prompt}]
        async with get_async_client(timeout=30) as client:
            resp = await client.post(
                f"{base}/chat/completions",
                headers={"Authorization": f"Bearer {settings.ai_api_key}"},
                json={"model": model, "messages": messages},
            )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]

    return _complete


async def _anthropic_complete(prompt: str, system: str | None) -> str:
    from .utils.http_client import get_async_client  # AC-5 — canonical factory
    base = settings.ai_base_url or "https://api.anthropic.com/v1"
    model = settings.ai_model or "claude-3-5-haiku-latest"
    body = {"model": model, "max_tokens": 1024, "messages": [{"role": "user", "content": prompt}]}
    if system:
        body["system"] = system
    async with get_async_client(timeout=20) as client:
        resp = await client.post(
            f"{base}/messages",
            headers={"x-api-key": settings.ai_api_key or "", "anthropic-version": "2023-06-01"},
            json=body,
        )
    resp.raise_for_status()
    return resp.json()["content"][0]["text"]


def configure_ai() -> None:
    """Activate a real provider when env-configured; otherwise stay on the deterministic fallback.
    Idempotent — safe to call more than once."""
    global _active_provider
    p = (settings.ai_provider or "none").lower()
    if p in _OPENAI_COMPAT and settings.ai_api_key:
        register_provider(p, _openai_compatible(p))
        _active_provider = p
        logger.info("ai: provider = %s (model=%s)", p, settings.ai_model or _OPENAI_COMPAT[p][1])
    elif p == "anthropic" and settings.ai_api_key:
        register_provider("anthropic", _anthropic_complete)
        _active_provider = "anthropic"
        logger.info("ai: provider = anthropic (model=%s)", settings.ai_model or "claude-3-5-haiku-latest")
    else:
        _active_provider = "none"
        logger.info("ai: provider = none (deterministic fallback)")


# ---- the gateway: always returns text, never raises, never hangs ----

async def complete(prompt: str, *, system: str | None = None) -> str:
    """The single completion gateway. Uses the live provider when configured; on no provider OR any
    provider failure, returns the deterministic stub. Fully fail-soft."""
    fn = _PROVIDERS.get(_active_provider)
    if fn is None:
        return _deterministic_stub(prompt, system)
    try:
        out = await fn(prompt, system)
        return out or _deterministic_stub(prompt, system)
    except Exception:
        logger.exception("ai: provider '%s' failed; using deterministic fallback", _active_provider)
        return _deterministic_stub(prompt, system)


# ============================================================================================
# Capability 1 — lead scoring (deterministic, always on; pure function, no external call)
# ============================================================================================

_SOURCE_SCORE = {"Referral": 25, "Website": 25, "Ad": 12, "Cold Call": 5}
_STATUS_DELTA = {"validated_lead": 10, "assigned": 20, "deal": 25, "contract_signed": 30, "lost": -20}


def score_lead(record_fields: dict) -> dict:
    """Transparent rule-based lead score → {score: 0-100, band: hot|warm|cold, reasons: [...]}.
    Signals: contactability (phone/email), named contact, source intent, lifecycle progression."""
    f = record_fields or {}
    score = 0
    reasons: list[str] = []

    if f.get("phone"):
        score += 30; reasons.append("has phone (+30)")
    if f.get("email"):
        score += 25; reasons.append("has email (+25)")
    if f.get("name"):
        score += 10; reasons.append("named contact (+10)")

    source = (f.get("source") or "").strip()
    if source in _SOURCE_SCORE:
        d = _SOURCE_SCORE[source]; score += d; reasons.append(f"source '{source}' (+{d})")

    status = (f.get("status") or "").strip().lower()
    if status in _STATUS_DELTA:
        d = _STATUS_DELTA[status]; score += d
        reasons.append(f"status {status} ({'+' if d > 0 else ''}{d})")

    score = max(0, min(100, score))
    band = "hot" if score >= 70 else "warm" if score >= 40 else "cold"
    if not reasons:
        reasons.append("no signals available")
    return {"score": score, "band": band, "reasons": reasons}


# ============================================================================================
# Capability 2 — summarize (uses the gateway: templated today, real LLM when a key is set)
# ============================================================================================

async def summarize_record(fields: dict) -> str:
    """Build a prompt from a record's fields and route it through `complete()`. Returns a templated
    summary with no provider, a real LLM summary when one is configured — same call either way."""
    facts = [f"- {k}: {v}" for k, v in (fields or {}).items() if v not in (None, "", [], {})]
    prompt = "Summarize this record in 1-2 plain sentences:\n" + "\n".join(facts)
    system = "You are a concise assistant for an ISP back-office. Summarize the record plainly."
    return await complete(prompt, system=system)


# ============================================================================================
# Capability 3 — Ask GAAhex (the assistant: answers a question grounded in live business context)
# ============================================================================================

ASSISTANT_SYSTEM = (
    "You are the GAAhex assistant for an ISP back-office. Answer the user's question concisely and "
    "plainly, using ONLY the business context provided below. Money is Armenian Dram (֏). If the "
    "context doesn't contain the answer, say so honestly and suggest where in GAAhex to look. Do not "
    "invent numbers."
)


async def ask_assistant(question: str, context_lines: list[str]) -> str:
    """Answer a free-text question grounded in the caller's live, scoped business context. With no
    provider this returns the deterministic stub (an extractive readout of the context); with a
    provider it's a real answer. The context is gathered + scoped by the router, never here."""
    ctx = "\n".join(context_lines) if context_lines else "- (no context available)"
    prompt = f"Business context:\n{ctx}\n\nQuestion: {question}\n\nAnswer:"
    return await complete(prompt, system=ASSISTANT_SYSTEM)


# ============================================================================================
# Capability 4 — agent planner: the model PROPOSES a structured action (it never executes).
# Execution is plain, permission-checked, audited server code in the router, only after the user
# confirms. The LLM is kept entirely out of the write path — it only translates intent → JSON.
# ============================================================================================

import json
import re

# The tools the planner may propose. Kept tiny + safe for v1 (leads only). The router validates
# every proposal again before executing — the model is never trusted blindly.
ACTION_SPEC = (
    "You may either ANSWER the user, or PROPOSE exactly ONE action. Available actions:\n"
    "  - create_lead(name, phone?, email?, source?)   # source one of: Website, Referral, Cold Call, Ad\n"
    "  - move_lead(lead_name, to_status)               # to_status one of: NEW, CONTACTED, QUALIFIED, CONVERTED, LOST\n"
    "Reply with ONLY a single JSON object, no prose, no markdown fences:\n"
    '  to answer: {"kind":"answer","text":"<your answer>"}\n'
    '  to act:    {"kind":"proposal","action":"create_lead","args":{...},"summary":"<one-line confirmation in plain language>"}\n'
    "Propose an action ONLY when the user clearly asks to create or change something; otherwise answer. "
    "Use the business context for answers; never invent numbers."
)


def _extract_json(text: str) -> dict | None:
    """Best-effort: pull the first {...} JSON object out of a model reply (tolerates code fences /
    stray prose). Returns the parsed dict or None."""
    if not text:
        return None
    m = re.search(r"\{.*\}", text.strip(), re.DOTALL)
    if not m:
        return None
    try:
        out = json.loads(m.group(0))
        return out if isinstance(out, dict) else None
    except (json.JSONDecodeError, ValueError):
        return None


async def plan_chat(question: str, context_lines: list[str]) -> dict:
    """Decide answer-vs-action for a chat turn. Returns {"kind":"answer","text":..} or
    {"kind":"proposal","action":..,"args":{..},"summary":..}. With no real provider, always answers
    (read-only) — actions need a model that can plan. Never executes anything."""
    if active_provider() == "none":
        return {"kind": "answer", "text": await ask_assistant(question, context_lines)}
    ctx = "\n".join(context_lines) if context_lines else "- (no context available)"
    prompt = f"{ACTION_SPEC}\n\nBusiness context:\n{ctx}\n\nUser: {question}"
    raw = await complete(prompt, system="You are the GAAhex assistant. Follow the response format exactly.")
    parsed = _extract_json(raw)
    if parsed and parsed.get("kind") == "proposal" and isinstance(parsed.get("args"), dict):
        return {"kind": "proposal", "action": str(parsed.get("action") or ""),
                "args": parsed["args"], "summary": str(parsed.get("summary") or "Confirm this action?")}
    if parsed and parsed.get("kind") == "answer":
        return {"kind": "answer", "text": str(parsed.get("text") or "").strip() or raw.strip()}
    return {"kind": "answer", "text": raw.strip() or "I'm not sure how to help with that."}


# Activate at import time, guarded by settings (non-invasive — no main.py change needed).
configure_ai()
