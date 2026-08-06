"""PejuAfrica API — application settings."""

from functools import lru_cache
from typing import List

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "PejuAfrica"
    app_env: str = "development"
    debug: bool = True
    # SQLAlchemy query logging — off by default (startup create_all is very noisy)
    sql_echo: bool = False
    api_v1_prefix: str = "/api/v1"

    secret_key: str = Field(..., min_length=32)
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 30
    cookie_secure: bool = False
    cookie_domain: str = "localhost"
    cors_origins: List[str] = ["http://localhost:3000"]

    database_url: str
    database_url_sync: str

    turso_database_url: str = ""
    turso_auth_token: str = ""

    redis_url: str = "redis://localhost:6379/0"
    frontend_url: str = "http://localhost:3000"

    bootstrap_superadmin_email: str = "admin@pejuafrica.com"
    bootstrap_superadmin_password: str = "ChangeMeNow!123"
    bootstrap_superadmin_name: str = "Peju Super Admin"

    access_cookie_name: str = "peju_access"
    refresh_cookie_name: str = "peju_refresh"

    paystack_secret_key: str = ""
    paystack_webhook_secret: str = ""
    flutterwave_secret_key: str = ""
    flutterwave_webhook_secret: str = ""

    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    llm_provider: str = "auto"  # auto | openai | template
    rate_limit_auth_per_minute: int = 20
    rate_limit_generate_per_hour: int = 10
    upload_dir: str = "data/uploads"

    # Cloudinary (fallback when Super Admin has not saved credentials yet)
    cloudinary_cloud_name: str = ""
    cloudinary_api_key: str = ""
    cloudinary_api_secret: str = ""
    cloudinary_folder_prefix: str = "pejuafrica"

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def llm_enabled(self) -> bool:
        if self.llm_provider == "template":
            return False
        if self.llm_provider == "openai":
            return bool(self.openai_api_key)
        return bool(self.openai_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
