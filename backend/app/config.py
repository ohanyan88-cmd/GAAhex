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


settings = Settings()
