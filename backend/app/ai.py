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

logger = logging.getLogger("gaaex.ai")

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
    "gemini": ("https://generativelanguage.googleapis.com/v1beta/openai", "gemini-2.0-flash"),
    "groq":   ("https://api.groq.com/openai/v1", "llama-3.3-70b-versatile"),
}


def _openai_compatible(provider: str) -> CompletionFn:
    """Build a completion fn for any OpenAI-compatible provider (openai/gemini/groq)."""
    default_base, default_model = _OPENAI_COMPAT[provider]

    async def _complete(prompt: str, system: str | None) -> str:
        import httpx  # already a dependency; lazy so it's only paid when a provider is live
        base = settings.ai_base_url or default_base
        model = settings.ai_model or default_model
        messages = ([{"role": "system", "content": system}] if system else []) + \
                   [{"role": "user", "content": prompt}]
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{base}/chat/completions",
                headers={"Authorization": f"Bearer {settings.ai_api_key}"},
                json={"model": model, "messages": messages},
            )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]

    return _complete


async def _anthropic_complete(prompt: str, system: str | None) -> str:
    import httpx
    base = settings.ai_base_url or "https://api.anthropic.com/v1"
    model = settings.ai_model or "claude-3-5-haiku-latest"
    body = {"model": model, "max_tokens": 1024, "messages": [{"role": "user", "content": prompt}]}
    if system:
        body["system"] = system
    async with httpx.AsyncClient(timeout=20) as client:
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
_STATUS_DELTA = {"CONTACTED": 10, "QUALIFIED": 20, "LOST": -20}


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

    status = (f.get("status") or "").strip().upper()
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
# Capability 3 — Ask GAAex (the assistant: answers a question grounded in live business context)
# ============================================================================================

ASSISTANT_SYSTEM = (
    "You are the GAAex assistant for an ISP back-office. Answer the user's question concisely and "
    "plainly, using ONLY the business context provided below. Money is Armenian Dram (֏). If the "
    "context doesn't contain the answer, say so honestly and suggest where in GAAex to look. Do not "
    "invent numbers."
)


async def ask_assistant(question: str, context_lines: list[str]) -> str:
    """Answer a free-text question grounded in the caller's live, scoped business context. With no
    provider this returns the deterministic stub (an extractive readout of the context); with a
    provider it's a real answer. The context is gathered + scoped by the router, never here."""
    ctx = "\n".join(context_lines) if context_lines else "- (no context available)"
    prompt = f"Business context:\n{ctx}\n\nQuestion: {question}\n\nAnswer:"
    return await complete(prompt, system=ASSISTANT_SYSTEM)


# Activate at import time, guarded by settings (non-invasive — no main.py change needed).
configure_ai()
