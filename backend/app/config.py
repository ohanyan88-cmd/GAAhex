import os
import uuid

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration, loaded from environment / .env."""
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # M1-A Wave 4 / C3-C4 — deploy-time environment signal. Default is "production" so the posture is
    # FAIL-CLOSED: a forgotten/unset ENVIRONMENT is treated as production-strict, never permissive.
    # dev/test/CI declare themselves EXPLICITLY (conftest sets ENVIRONMENT=test; .env.example +
    # docker-compose set ENVIRONMENT=development). Every security gate keys off is_production() (below),
    # not a raw `== "production"` compare, so a typo ("prod"/"Production") also fails closed.
    # See docs/M1A-DEPLOY-CONTRACT.md.
    environment: str = "production"
    database_url: str = "postgresql+asyncpg://gaahex:gaahex@localhost:5433/gaahex"
    # Privileged (RLS-bypassing) role for the few pre-auth / no-tenant paths: seeding, the
    # login + current_user user lookup, and /org-tree. Falls back to database_url when unset (e.g.
    # tests, or before the RLS enforcement flip). In prod: database_url=gaahex_app, this=gaahex.
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
    # C5: production bootstrap super-admin. The demo admin@demo.isp/admin123 god-account is gated OUT
    # of production (app/seed.py); on a fresh prod boot the FIRST super-admin is created from these
    # instead. The email is a public identity (safe to default); the PASSWORD is NEVER hardcoded — it
    # MUST come from the BOOTSTRAP_ADMIN_PASSWORD env (strong, 12+ chars) or boot is refused. Unset =
    # no admin seeded (loud warning). Rotate it on first login (auth.py force-change).
    bootstrap_admin_email: str = "admin@gaahex.com"
    bootstrap_admin_password: str = ""
    # S3: CORS allowed origins; comma-separated. Default "*" keeps dev/tests working.
    # In prod set CORS_ORIGINS=https://app.example.com (comma-separate multiple origins)
    cors_origins: str = "*"
    # E38: webhook SSRF guard. Default OFF blocks private/loopback/reserved targets. Set
    # WEBHOOK_ALLOW_PRIVATE=true only in a trusted network that legitimately needs internal webhooks.
    webhook_allow_private: bool = False

    # ─── Mail module (per-tenant email client — MAILBOX-MODULE-PLAN.md) ───────
    # All default OFF so a fresh clone / CI boot is fully inert: no IMAP socket, no sync task.
    # Per-tenant SMTP/IMAP credentials live on the `mail_account` row (Fernet-encrypted), NOT here —
    # these are only the module-level kill-switches + sync tuning.
    feature_mail_enabled: bool = False        # mounts /api/mail/* behavior; OFF = module inert
    mail_sync_enabled: bool = False           # Phase B: IMAP inbound sync worker on/off
    mail_sync_poll_seconds: int = 120         # poll cadence per account (IDLE used opportunistically)
    mail_sync_fetch_batch: int = 200          # max messages fetched per sync chunk (memory bound)
    mail_sync_max_message_bytes: int = 25 * 1024 * 1024  # > this → headers-only (no body/attachment pull)

    # GXL cross-record guard reach (M1 Phase 1.5 — sealed GXL Extension addendum §9 Tier-2 rollback).
    # Default ON: a workflow guard may dereference one hop into a linked record (`account.balance_due`).
    # Flip OFF (FEATURE_GXL_CROSS_RECORD_ENABLED=false) as an immediate kill-switch if the resolver
    # misbehaves in prod — any guard with cross-record reach is then rejected (fail-closed); existing
    # local-field guards keep working unchanged.
    feature_gxl_cross_record_enabled: bool = True

    # ─── S4 Stage 2: Portal authentication mode (default-OFF cookie, prod-required) ────
    # Controls how `/portal/auth/*` issues and validates the customer-facing access token.
    #   "header" — legacy bearer-only flow (Authorization: Bearer <jwt>). DEV-DEFAULT for
    #              backward compat: every existing fixture / test / SPA depends on this
    #              shape. PRODUCTION-FORBIDDEN — the prod contract below refuses to boot
    #              when ENVIRONMENT=production and PORTAL_AUTH_MODE=header.
    #   "cookie" — HttpOnly cookie (gaahex_portal_session) ONLY. The bearer header is
    #              rejected by `current_customer`. CSRF double-submit token required on
    #              mutating verbs (POST/PUT/PATCH/DELETE) via the X-CSRF-Token header.
    #   "both"   — issue both, accept either, prefer the cookie. Used for the cutover
    #              window so an in-flight SPA can keep working while it migrates to the
    #              cookie flow. CSRF token still required on mutating verbs (we have no
    #              way to know if the caller used the cookie or the header — assume cookie).
    portal_auth_mode: str = "header"

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
    payment_provider: str = "dev"              # dev|idram|telcell|arca|easypay
    # C2 KILL-SWITCH — inbound payment callbacks/webhooks are DISABLED until go-live. Default OFF: every
    # inbound payment callback (/payment/callback/{provider} AND /api/webhooks/stripe) returns 503 before
    # any verification or settle, so the unsigned-callback forgery surface is closed platform-wide while
    # NO provider is genuinely live. Flip FEATURE_PAYMENTS_ENABLED=true ONLY after reviewing the active
    # provider's signature verification (the per-vendor go-live checklist: idram/easypay/telcell/arca
    # default ok=False + full-payload-bound signatures; easypay/telcell check_status is still a stub).
    feature_payments_enabled: bool = False
    idram_merchant_id: str | None = None
    idram_secret_key: str | None = None
    telcell_merchant: str | None = None
    telcell_key: str | None = None
    arca_merchant: str | None = None
    arca_password: str | None = None
    easypay_merchant_id: str | None = None
    easypay_secret_key: str | None = None
    payment_callback_base_url: str | None = None   # public base URL the provider POSTs callbacks to

    # ─── M1-C: Payment gateway (Stripe / vault-card flow) ──────────────────
    # Independent of the legacy ``payment_provider`` setting above (which drives
    # the old DevGateway/idram/telcell/arca/easypay redirect flow). The M1-C
    # gateway is the modern Stripe Elements + PaymentIntents flow.
    payment_gateway_provider: str = "mock"          # 'mock' | 'logging' | 'stripe'
    stripe_publishable_key: str | None = None       # pk_test_... / pk_live_... (frontend)
    stripe_secret_key: str | None = None            # sk_test_... / sk_live_...
    stripe_webhook_secret: str | None = None        # whsec_...
    stripe_api_version: str = "2024-06-20"

    # ─── M1-C: SMS gateway (Twilio) ────────────────────────────────────────
    # ``sms_provider`` (above) is the legacy channels.py switch. M1-C introduces
    # a separate ``sms_gateway_provider`` for the new gateway abstraction. Keep
    # both during migration; remove ``sms_provider`` once channels.py is reskinned.
    sms_gateway_provider: str = "mock"              # 'mock' | 'twilio'
    twilio_from_number: str | None = None           # E.164, e.g. +14155551234
    twilio_messaging_service_sid: str | None = None # MG... (alt. to from_number)
    twilio_status_callback_url: str | None = None   # public URL Twilio POSTs status to
    twilio_webhook_auth_token: str | None = None    # for verifying incoming signatures

    # ─── M1-C: Email gateway (SendGrid) ────────────────────────────────────
    email_gateway_provider: str = "mock"            # 'mock' | 'sendgrid'
    sendgrid_api_key: str | None = None             # SG.<long>
    sendgrid_from_email: str | None = None          # billing@yourisp.com
    sendgrid_from_name: str | None = None           # "Your ISP Billing"
    sendgrid_webhook_public_key: str | None = None  # ECDSA public key for event webhook

    # ─── M1-C: RADIUS backend (FreeRADIUS) ─────────────────────────────────
    radius_backend_provider: str = "mock"           # 'mock' | 'freeradius'
    radius_host: str | None = None
    radius_auth_port: int = 1812
    radius_acct_port: int = 1813
    radius_secret: str | None = None                # shared secret with RADIUS server
    radius_nas_ip: str | None = None                # our NAS-IP-Address attribute
    radius_dictionary_path: str | None = None       # path to RADIUS dictionary files

    # ─── Feature gates (Packs P3-P6: RADIUS, OLT, Import, Warehouse) ───────
    # All default to False so dev / test / fresh-clone boot with every subsystem
    # OFF. Flipping any of these ON in production WITHOUT a real backend behind
    # it is a hard RuntimeError at startup (see _assert_production_deploy_contract).
    # Packs P3-P6 will call into app.services.feature_gate.require_*() at every
    # subsystem entry point so a call site cannot accidentally exercise a stub
    # backend in production. See app/services/feature_gate.py for the gate logic.
    feature_radius_required: bool = False              # FEATURE_RADIUS_REQUIRED
    feature_olt_provisioning_required: bool = False    # FEATURE_OLT_PROVISIONING_REQUIRED
    feature_import_engine_enabled: bool = False        # FEATURE_IMPORT_ENGINE_ENABLED
    feature_warehouse_enabled: bool = False            # FEATURE_WAREHOUSE_ENABLED

    # ─── Attachment storage backend ──────────────────────────────────────────
    # Vendor-agnostic via StorageBackend Protocol in app/services/storage/.
    # v1 default: local disk (zero infra, works in docker-compose on-prem).
    # Before production multi-node: swap to 'minio' (self-hosted S3-compatible)
    # or 's3' (AWS S3). See docs/PRE-LAUNCH-CHECKLIST.md §1 — Storage.
    storage_backend: str = "local"          # 'local' | 'minio' | 's3'
    storage_local_path: str = "/app/uploads"  # mount point inside the container
    storage_minio_endpoint: str | None = None     # e.g. "minio:9000"
    storage_minio_access_key: str | None = None
    storage_minio_secret_key: str | None = None
    storage_minio_bucket: str = "portal-attachments"
    storage_minio_secure: bool = False            # True for HTTPS MinIO
    storage_s3_bucket: str | None = None
    storage_s3_region: str = "us-east-1"
    storage_s3_access_key: str | None = None
    storage_s3_secret_key: str | None = None
    # Max upload size (bytes). Default 100 MB per file 04 Attachment Standard.
    storage_max_file_bytes: int = 100 * 1024 * 1024


settings = Settings()


# ---- C3/C4 — fail-safe production detection -------------------------------------------------------
# The deploy contract + every secret/credential gate keys off is_production(), NOT a raw
# `settings.environment == "production"` compare, so a TYPO ("prod", "Production") or an UNSET/empty
# ENVIRONMENT can never silently downgrade a real deployment to permissive behaviour. Only an EXPLICIT,
# recognised non-production value relaxes; everything else (including the default) is production-strict.
_NON_PRODUCTION_ENVIRONMENTS: frozenset[str] = frozenset({
    "development", "dev", "test", "testing", "ci", "local",
})
_RECOGNISED_ENVIRONMENTS: frozenset[str] = _NON_PRODUCTION_ENVIRONMENTS | frozenset({"production", "staging"})


def is_production() -> bool:
    """True (strict posture) unless ENVIRONMENT is an EXPLICIT recognised non-production value.

    Fail-closed: unset/empty, typo'd, or unrecognised values all resolve to production-strict. Only
    development/dev/test/testing/ci/local relax. 'staging' is treated as production (a real deploy with
    real secrets)."""
    return (settings.environment or "").strip().lower() not in _NON_PRODUCTION_ENVIRONMENTS


def environment_is_recognised() -> bool:
    """Whether ENVIRONMENT is a known value — a false result means a typo is being treated as
    production-strict, and boot logs a warning so the operator can fix the spelling."""
    return (settings.environment or "").strip().lower() in _RECOGNISED_ENVIRONMENTS


def assert_production_secrets() -> None:
    """C3 — refuse to boot in production on a weak/default JWT secret.

    Keyed off is_production() (fail-closed), NOT the opt-in require_strong_secrets flag — a forgotten
    flag must never let the dev secret reach a real deploy. require_strong_secrets is retained as an
    extra force-on so non-production hardening checks can be exercised too."""
    if is_production() or settings.require_strong_secrets:
        if settings.jwt_secret == "dev-only-change-me" or len(settings.jwt_secret) < 32:
            raise RuntimeError(
                "Weak JWT secret in production — set a 32+ byte JWT_SECRET. Refusing to boot."
            )


# ---- M1-A Wave 4 — production deploy contract ----------------------------------------------------
def _assert_production_deploy_contract() -> None:
    """Refuse to boot in production if RLS won't engage.

    In production we require DATABASE_URL (the app role) and OWNER_DATABASE_URL
    (the table-owner role) to be DIFFERENT, so the app connection runs as a
    NOSUPERUSER role and Postgres RLS policies actually filter rows.

    In dev/test, owner falls back to the app URL — convenient but RLS-decorative.
    This is intentional and matches the existing test pattern (test_rls.py uses
    its own gaahex_app engine to validate RLS in isolation).

    See docs/M1A-DEPLOY-CONTRACT.md for the deploy contract details.
    """
    if not is_production():
        return  # explicit dev / test — no requirement (fail-closed: typo/unset → strict)

    db_url = settings.database_url
    owner_url = settings.owner_database_url or settings.database_url

    if db_url == owner_url:
        raise RuntimeError(
            "M1-A production deploy contract violation: DATABASE_URL and "
            "OWNER_DATABASE_URL are equal. In production these MUST be "
            "different Postgres roles (gaahex_app for the app, gaahex for the "
            "owner) so that Row-Level Security policies engage. See "
            "docs/M1A-DEPLOY-CONTRACT.md."
        )

    # Verify the roles are different by parsing the URLs. We strip the asyncpg
    # driver suffix so urlparse can read the userinfo portion of the netloc.
    from urllib.parse import urlparse
    app_role = urlparse(db_url.replace("postgresql+asyncpg://", "postgresql://")).username
    owner_role = urlparse(owner_url.replace("postgresql+asyncpg://", "postgresql://")).username

    if app_role == owner_role:
        raise RuntimeError(
            f"M1-A production deploy contract violation: DATABASE_URL and "
            f"OWNER_DATABASE_URL use the same role ({app_role!r}). The app "
            f"role must be different from the owner role. See "
            f"docs/M1A-DEPLOY-CONTRACT.md."
        )

    # H3 — CORS wildcard refusal. A production deploy with
    # CORS_ORIGINS=* (or any entry containing '*') would allow every origin on
    # the internet to talk to the API with credentials; that's never the right
    # configuration for a real ISP tenant. Dev/test keep the default "*" because not is_production()
    # exits early at the top of this function; staging + production both refuse it (is_production()
    # is True for both).
    cors_raw = (settings.cors_origins or "").strip()
    if cors_raw == "*" or any(o.strip() == "*" or "*" in o for o in cors_raw.split(",")):
        raise RuntimeError(
            "Production deploy contract violation: CORS_ORIGINS contains a "
            "wildcard ('*'). Set CORS_ORIGINS to an explicit, comma-separated "
            "list of trusted frontend origins (e.g. https://app.example.com). "
            "Wildcards are forbidden in production. See docs/M1A-DEPLOY-CONTRACT.md."
        )

    # S1 — Mock-provider refusal. The mock gateways exist so dev/test/CI can
    # exercise the gateway interfaces without external network. They MUST NOT
    # be the active provider in production: a mock payment gateway silently
    # marks every charge "successful" with no money moved, mock email/SMS drop
    # outbound traffic on the floor, and mock RADIUS leaves every customer
    # session unauthenticated.
    mock_providers = {
        "payment_gateway_provider": settings.payment_gateway_provider,
        "email_gateway_provider": settings.email_gateway_provider,
        "sms_gateway_provider": settings.sms_gateway_provider,
        "radius_backend_provider": settings.radius_backend_provider,
    }
    offenders = sorted(name for name, value in mock_providers.items() if value == "mock")
    if offenders:
        raise RuntimeError(
            "Production deploy contract violation: the following provider(s) "
            f"are still set to 'mock' in production: {', '.join(offenders)}. "
            "Configure a real provider (Stripe / SendGrid / Twilio / FreeRADIUS) "
            "via the corresponding *_PROVIDER env var. See "
            "docs/M1A-DEPLOY-CONTRACT.md."
        )

    # ── S4 Stage 2: portal_auth_mode production contract ──────────────────
    # Production MUST use either "cookie" or "both" — the legacy "header" mode emits the JWT
    # in a JSON response body, where any XSS in the SPA can lift it from JS-accessible storage.
    # The HttpOnly cookie mode makes the token unreachable from the renderer. "both" is allowed
    # in prod for the migration window (cookie issued + header accepted), but the header-only
    # flow is hard-rejected. Block is in its own logical scope to keep it adjacent to Pack P1's
    # FeatureGate prod contract below.
    portal_mode = (settings.portal_auth_mode or "").lower()
    if portal_mode == "header":
        raise RuntimeError(
            "Production deploy contract violation: PORTAL_AUTH_MODE=header forbidden in "
            "production. The legacy bearer-only flow exposes the customer JWT to any XSS in "
            "the SPA — set PORTAL_AUTH_MODE=cookie (HttpOnly cookie only) or 'both' "
            "(cookie + bearer; migration window). See docs/M1A-DEPLOY-CONTRACT.md."
        )
    if portal_mode not in {"cookie", "both"}:
        raise RuntimeError(
            f"Production deploy contract violation: PORTAL_AUTH_MODE={settings.portal_auth_mode!r} "
            "is not a recognized value. Use 'cookie' or 'both' in production "
            "(or 'header' in dev/test/staging). See docs/M1A-DEPLOY-CONTRACT.md."
        )

    # ── Feature-gate sanity (Packs P3-P6) ─────────────────────────────────
    # If a subsystem feature flag is ON in production it MUST have a real
    # implementation behind it. Failing this check at boot is the WHOLE point
    # of the fail-closed posture: we'd rather refuse to start than silently
    # exercise a stub RADIUS backend / mock OLT driver / un-implemented import
    # engine in front of real customer data.

    # 1. RADIUS: feature ON + (mock/stub provider OR backend won't construct).
    if settings.feature_radius_required:
        radius_provider = (settings.radius_backend_provider or "").lower()
        if radius_provider in ("mock", "stub"):
            raise RuntimeError(
                "Production deploy contract violation: FEATURE_RADIUS_REQUIRED=true "
                f"but RADIUS_BACKEND_PROVIDER={radius_provider!r} is a stub. "
                "Configure a real backend (e.g. 'freeradius') with RADIUS_HOST, "
                "RADIUS_SECRET, RADIUS_NAS_IP set. See docs/M1A-DEPLOY-CONTRACT.md."
            )
        try:
            from .services.radius.exceptions import RadiusBackendConfigError
            from .services.radius.factory import _REGISTRY as _RADIUS_REGISTRY
            builder = _RADIUS_REGISTRY.get(radius_provider)
            if builder is None:
                raise RuntimeError(
                    f"Production deploy contract violation: RADIUS_BACKEND_PROVIDER="
                    f"{radius_provider!r} is not registered. See docs/M1A-DEPLOY-CONTRACT.md."
                )
            try:
                builder()
            except (RadiusBackendConfigError, ImportError) as e:
                raise RuntimeError(
                    "Production deploy contract violation: FEATURE_RADIUS_REQUIRED=true "
                    f"but RADIUS backend {radius_provider!r} failed to construct: {e}. "
                    "Fix RADIUS_HOST / RADIUS_SECRET / RADIUS_NAS_IP / RADIUS_DICTIONARY_PATH. "
                    "See docs/M1A-DEPLOY-CONTRACT.md."
                )
        except ImportError as e:
            raise RuntimeError(
                "Production deploy contract violation: FEATURE_RADIUS_REQUIRED=true "
                f"but the RADIUS service layer could not be imported: {e}. "
                "See docs/M1A-DEPLOY-CONTRACT.md."
            )

    # 2. OLT: feature ON + driver registry has only the mock entry.
    if settings.feature_olt_provisioning_required:
        try:
            from .services.olt.factory import registered_vendors
            real_vendors = [v for v in registered_vendors() if v.lower() != "mock"]
            if not real_vendors:
                raise RuntimeError(
                    "Production deploy contract violation: "
                    "FEATURE_OLT_PROVISIONING_REQUIRED=true but no real OLT vendor "
                    "driver is registered (only 'mock'). Phases P3 (Huawei) / P4 (ZTE) "
                    "must ship and self-register before this flag is flipped on. See "
                    "docs/M1A-DEPLOY-CONTRACT.md."
                )
        except ImportError as e:
            raise RuntimeError(
                "Production deploy contract violation: "
                "FEATURE_OLT_PROVISIONING_REQUIRED=true but the OLT service layer "
                f"could not be imported: {e}. See docs/M1A-DEPLOY-CONTRACT.md."
            )

    # 3. IMPORT: feature ON + engine implementation has not landed.
    if settings.feature_import_engine_enabled:
        from .services.feature_gate import IMPORT_ENGINE_IMPLEMENTED
        if not IMPORT_ENGINE_IMPLEMENTED:
            raise RuntimeError(
                "Production deploy contract violation: FEATURE_IMPORT_ENGINE_ENABLED=true "
                "but the import engine has not been implemented yet "
                "(app.services.feature_gate.IMPORT_ENGINE_IMPLEMENTED is False). "
                "Flip the sentinel to True in the same commit that lands the real "
                "engine. See docs/M1A-DEPLOY-CONTRACT.md."
            )

    # 4. WAREHOUSE: feature ON + module has not landed.
    if settings.feature_warehouse_enabled:
        from .services.feature_gate import WAREHOUSE_IMPLEMENTED
        if not WAREHOUSE_IMPLEMENTED:
            raise RuntimeError(
                "Production deploy contract violation: FEATURE_WAREHOUSE_ENABLED=true "
                "but the warehouse module has not been implemented yet "
                "(app.services.feature_gate.WAREHOUSE_IMPLEMENTED is False). "
                "Flip the sentinel to True in the same commit that lands the real "
                "module. See docs/M1A-DEPLOY-CONTRACT.md."
            )


# ---- legacy single-tenant helpers (DO NOT USE IN REQUEST PATHS) ----------------------------------
# WAVE 1 multi-tenant hardening (M1-A audit): the staff request path and the scheduler no longer
# read from THE_TENANT_ID. Every staff request now binds the RLS GUC to `user.tenant_id` (validated
# against the JWT `tenant` claim — see `routers/auth.py::current_user`), and the scheduler iterates
# over every Tenant row per sweep (see `scheduler.py`).
#
# These helpers REMAIN ONLY for:
#   1. `seed.py` — bootstrap warm-up: when only one tenant exists at install time, pinning its id
#      makes the seed deterministic. Seed is a one-shot install step, not a request path.
#   2. `routers/portal_auth.py` — customer-facing email login has no per-request tenant hint, so
#      single-tenant binding is still appropriate there. Deferred until portal multi-tenancy
#      is a real product requirement (out of scope for Wave 1).
#
# Adding new references from request-handling code is a regression. Use `user.tenant_id` instead.
#
# Resolution order (when these helpers ARE called):
#   1. env GAAHEX_TENANT_ID (explicit override, useful in prod / staging)
#   2. the oldest Tenant row in the database (resolved on first call, then cached)
_THE_TENANT_ID: uuid.UUID | None = (
    uuid.UUID(os.environ["GAAHEX_TENANT_ID"]) if os.environ.get("GAAHEX_TENANT_ID") else None
)


def _set_the_tenant_id(tid: uuid.UUID) -> None:
    """Pre-warm or override the cache. Called by the seed once the demo tenant exists, and exposed
    so callers can pin a specific UUID at startup without a DB round-trip."""
    global _THE_TENANT_ID
    _THE_TENANT_ID = tid


async def the_tenant_id_async() -> uuid.UUID:
    """Async resolver — pulls the cached value or reads it from the DB exactly once.

    Resolution order:
      1. GAAHEX_TENANT_ID env var (set at import time)
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
