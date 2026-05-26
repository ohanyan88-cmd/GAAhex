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


settings = Settings()
