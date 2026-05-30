import os
import uuid

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration, loaded from environment / .env."""
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://gaaex:gaaex@localhost:5433/gaaex"
    # Privileged (RLS-bypassing) role for the few pre-auth / no-tenant paths: seeding, the
    # login + current_user user lookup, and /org-tree. Falls back to database_url when unset (e.g.
    # tests, or before the RLS enforcement flip). In prod: database_url=gaaex_app, this=gaaex.
    owner_database_url: str | None = None
    redis_url: str = "redis://localhost:6380/0"
    jwt_secret: str = "dev-only-change-me"
    jwt_alg: str = "HS256"
    access_token_minutes: int = 60
    refresh_token_days: int = 14          # lifetime of a stored (rotating) refresh token
    password_min_length: int = 8          # password policy: minimum length
    rate_limit_enabled: bool = False      # OFF by default so the test suite is unaffected; enable in prod
    rate_limit_per_min: int = 6000        # requests per principal-or-IP per fixed 1-minute window
    # S1: refuse to boot a prod deployment with the dev JWT secret (default-OFF; set REQUIRE_STRONG_SECRETS=true in prod)
    require_strong_secrets: bool = False
    # S3: CORS allowed origins; comma-separated. Default "*" keeps dev/tests working.
    # In prod set CORS_ORIGINS=https://app.example.com (comma-separate multiple origins)
    cors_origins: str = "*"
    # E38: webhook SSRF guard. Default OFF blocks private/loopback/reserved targets. Set
    # WEBHOOK_ALLOW_PRIVATE=true only in a trusted network that legitimately needs internal webhooks.
    webhook_allow_private: bool = False

    # ---- outbound channel providers (opt-in; unset ⇒ dev/console behavior, suite unaffected) ----
    email_provider: str = "dev"           # dev|smtp
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_user: str | None = None
    smtp_password: str | None = None
    smtp_from: str | None = None          # From: address (falls back to smtp_user)
    smtp_starttls: bool = True

    sms_provider: str = "dev"             # dev|twilio
    twilio_account_sid: str | None = None
    twilio_auth_token: str | None = None
    twilio_from: str | None = None        # sender phone number / messaging-service id

    # ---- AI assist (opt-in; "none" ⇒ deterministic rule-based results, no external calls) ----
    # gemini = Google's free tier (aistudio.google.com); groq = groq.com free tier — both
    # OpenAI-compatible, so they reuse the openai client with a provider-specific default base URL.
    ai_provider: str = "none"             # none|openai|anthropic|gemini|groq
    ai_api_key: str | None = None
    ai_model: str | None = None           # provider model id; sensible default per provider when unset
    ai_base_url: str | None = None        # override API base (proxy / self-host / Azure)

    # ---- background scheduler (opt-in; OFF by default so dev/test are unaffected) ----
    scheduler_enabled: bool = False        # true ⇒ auto-fire run-dunning/run-cycle/run-due per tenant
    scheduler_interval_seconds: int = 3600 # sweep cadence (default hourly)

    # ---- payment gateway (opt-in; dev ⇒ deterministic DevGateway, no external calls) ----
    payment_provider: str = "dev"              # dev|idram|telcell|arca
    idram_merchant_id: str | None = None
    idram_secret_key: str | None = None
    telcell_merchant: str | None = None
    telcell_key: str | None = None
    arca_merchant: str | None = None
    arca_password: str | None = None
    payment_callback_base_url: str | None = None   # public base URL the provider POSTs callbacks to


settings = Settings()


# ---- single-tenant mode (Option A) ----------------------------------------------------------------
# The whole app runs against ONE tenant. THE_TENANT_ID is the single source of truth that every
# request is bound to (RLS GUC, scheduler, portal login). Resolution order:
#   1. env GAAEX_TENANT_ID (explicit override, useful in prod / staging)
#   2. the one Tenant row in the database (resolved on first call, then cached)
# JWT `tenant` claims are no longer read — they may exist on legacy tokens but are ignored.
_THE_TENANT_ID: uuid.UUID | None = (
    uuid.UUID(os.environ["GAAEX_TENANT_ID"]) if os.environ.get("GAAEX_TENANT_ID") else None
)


def _set_the_tenant_id(tid: uuid.UUID) -> None:
    """Pre-warm or override the cache. Called by the seed once the demo tenant exists, and exposed
    so callers can pin a specific UUID at startup without a DB round-trip."""
    global _THE_TENANT_ID
    _THE_TENANT_ID = tid


async def the_tenant_id_async() -> uuid.UUID:
    """Async resolver — pulls the cached value or reads it from the DB exactly once.

    Resolution order:
      1. GAAEX_TENANT_ID env var (set at import time)
      2. cached value (set by the seed or a previous call)
      3. the oldest Tenant row in the database (single-tenant invariant — there should only be one
         in prod; tests insert isolation-probe rows after the cache is warmed so they don't shift it)
    """
    global _THE_TENANT_ID
    if _THE_TENANT_ID is not None:
        return _THE_TENANT_ID

    from sqlalchemy import select
    from .db import OwnerSessionLocal
    from .models import Tenant

    async with OwnerSessionLocal() as s:
        row = (await s.execute(select(Tenant).order_by(Tenant.created_at))).scalars().first()
    if row is None:
        raise RuntimeError("No tenant row found; seed the database before resolving THE_TENANT_ID")
    _THE_TENANT_ID = row.id
    return _THE_TENANT_ID


def the_tenant_id() -> uuid.UUID:
    """Sync resolver. Returns the cached value or raises if not yet warmed — request paths should
    call `the_tenant_id_async()` instead. Provided for non-async contexts (CLI tools, repl)."""
    if _THE_TENANT_ID is None:
        raise RuntimeError(
            "THE_TENANT_ID not yet resolved; call the_tenant_id_async() from an async context, "
            "or pre-warm via the seed."
        )
    return _THE_TENANT_ID
