# app/config.py
# ============================================================
# Zero Plus — AI Service
# Central configuration (Pydantic Settings)
# Reads from environment / .env and exposes typed settings
# ============================================================

from functools import lru_cache
from typing import List

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    All runtime configuration for the AI Service.
    Values are loaded from environment variables or a .env file.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ---------- Application ----------
    app_name: str = Field(default="zero-plus-ai", description="Service name")
    app_env: str = Field(default="development", description="development | staging | production")
    app_host: str = Field(default="0.0.0.0")
    app_port: int = Field(default=8001, ge=1, le=65535)
    app_debug: bool = Field(default=True)
    log_level: str = Field(default="INFO")

    # ---------- Security ----------
    ai_internal_token: str = Field(
        default="",
        description="Shared secret between Gateway and AI Service. Empty = no check yet.",
    )

    # ---------- Redis ----------
    redis_host: str = Field(default="127.0.0.1")
    redis_port: int = Field(default=6379, ge=1, le=65535)
    redis_db: int = Field(default=0, ge=0, le=15)
    redis_password: str = Field(default="")
    redis_ssl: bool = Field(default=False)

    ai_cache_ttl_sec: int = Field(default=10, ge=1, le=300, description="Cache TTL for /analyze results")
    session_ttl_sec: int = Field(default=1800, ge=60, description="How long we remember a session")
    session_history_size: int = Field(default=20, ge=5, le=100, description="Feature vectors kept per session")

    # ---------- Model persistence ----------
    model_store_path: str = Field(default="./models_store")
    model_save_every_n: int = Field(default=50, ge=1, description="Persist model every N learn_one calls")

    # ---------- Decision thresholds ----------
    anomaly_high_threshold: float = Field(default=0.75, ge=0.0, le=1.0)
    anomaly_medium_threshold: float = Field(default=0.45, ge=0.0, le=1.0)
    session_drift_high_threshold: float = Field(default=0.60, ge=0.0, le=1.0)
    session_drift_medium_threshold: float = Field(default=0.35, ge=0.0, le=1.0)
    revoke_on_high_drift: bool = Field(default=True)

    # ---------- Path sensitivity ----------
    high_sensitivity_paths: str = Field(
        default="/login,/checkout,/api/auth,/admin,/wp-login.php,/signin,/signup"
    )
    medium_sensitivity_paths: str = Field(
        default="/api/,/cart,/account,/profile,/payment"
    )

    # ---------- Initial training ----------
    default_org_size: str = Field(default="medium", description="small | medium | large")

    # ---------- Optional Backend ----------
    backend_base_url: str = Field(default="http://127.0.0.1:3000")
    backend_internal_token: str = Field(default="")

    # ---------- CORS ----------
    cors_origins: str = Field(default="http://localhost:5173,http://127.0.0.1:5173")

    # ------------------------------------------------------------------
    # Derived helpers (not env vars)
    # ------------------------------------------------------------------

    @property
    def high_sensitivity_path_list(self) -> List[str]:
        return [p.strip() for p in self.high_sensitivity_paths.split(",") if p.strip()]

    @property
    def medium_sensitivity_path_list(self) -> List[str]:
        return [p.strip() for p in self.medium_sensitivity_paths.split(",") if p.strip()]

    @property
    def cors_origins_list(self) -> List[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def redis_url(self) -> str:
        """Build a Redis connection URL."""
        scheme = "rediss" if self.redis_ssl else "redis"
        auth = f":{self.redis_password}@" if self.redis_password else ""
        return f"{scheme}://{auth}{self.redis_host}:{self.redis_port}/{self.redis_db}"

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() == "production"

    @field_validator("default_org_size")
    @classmethod
    def validate_org_size(cls, v: str) -> str:
        allowed = {"small", "medium", "large"}
        v = v.lower().strip()
        if v not in allowed:
            raise ValueError(f"default_org_size must be one of {allowed}")
        return v

    @field_validator("log_level")
    @classmethod
    def validate_log_level(cls, v: str) -> str:
        allowed = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}
        v = v.upper().strip()
        if v not in allowed:
            raise ValueError(f"log_level must be one of {allowed}")
        return v


@lru_cache
def get_settings() -> Settings:
    """
    Cached settings instance.
    Call get_settings() everywhere instead of creating Settings() repeatedly.
    """
    return Settings()