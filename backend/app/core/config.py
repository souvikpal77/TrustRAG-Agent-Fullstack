"""Application configuration loaded from environment variables.

Every secret (Gemini API key, database password) is read server-side only and is
never exposed through the API surface or shipped to the browser bundle.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _split_csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ------------------------------------------------------------------ app
    app_name: str = "TrustRAG-Agent API"
    version: str = "1.0.0"
    environment: Literal["development", "production", "test"] = "development"
    debug: bool = False
    log_level: str = "INFO"
    api_prefix: str = "/api"
    cors_origins: str = (
        "http://localhost:5173,http://localhost:8080,"
        "http://127.0.0.1:5173,http://127.0.0.1:8080"
    )
    # Optional regex for ephemeral frontend deployments (Vercel production and
    # preview URLs). Set to an empty string to allow explicit origins only.
    cors_origin_regex: str = r"https://([a-z0-9-]+\.)*vercel\.app"

    # ------------------------------------------------------------- database
    database_url: str = (
        "postgresql+asyncpg://trustrag:trustrag_dev_password@localhost:5432/trustrag"
    )
    db_echo: bool = False
    db_pool_size: int = Field(default=10, ge=1, le=100)
    db_max_overflow: int = Field(default=20, ge=0, le=100)
    auto_create_schema: bool = False

    # --------------------------------------------------------------- gemini
    google_api_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("GOOGLE_API_KEY", "GEMINI_API_KEY"),
    )
    gemini_models: str = "gemini-3.5-flash-lite,gemini-3.8-flash"
    gemini_temperature: float = Field(default=0.2, ge=0.0, le=1.0)
    gemini_max_output_tokens: int = Field(default=2048, ge=256, le=16384)
    gemini_timeout_seconds: int = Field(default=30, ge=5, le=300)
    gemini_max_retries: int = Field(default=2, ge=0, le=5)
    allow_offline_llm_fallback: bool = True

    # ------------------------------------------------------------ retrieval
    retrieval_default_top_k: int = Field(default=8, ge=1, le=50)
    retrieval_semantic_weight: float = Field(default=0.6, ge=0.0, le=1.0)
    retrieval_bm25_k1: float = Field(default=1.5, gt=0.0, le=5.0)
    retrieval_bm25_b: float = Field(default=0.75, ge=0.0, le=1.0)
    retrieval_max_candidates: int = Field(default=20000, ge=100, le=200000)

    # ---------------------------------------------------------- embeddings
    embedding_provider: Literal["hashing", "gemini"] = "hashing"
    embedding_dimensions: int = Field(default=384, ge=64, le=3072)
    gemini_embedding_model: str = "gemini-embedding-001"

    # ------------------------------------------------------------ chunking
    chunk_size: int = Field(default=1400, ge=200, le=8000)
    chunk_overlap: int = Field(default=220, ge=0, le=2000)
    chunk_min_size: int = Field(default=200, ge=0, le=2000)

    # --------------------------------------------------------------- trust
    trust_weight_provenance: float = Field(default=0.15, ge=0.0, le=1.0)
    trust_weight_authority: float = Field(default=0.15, ge=0.0, le=1.0)
    trust_weight_relevance: float = Field(default=0.20, ge=0.0, le=1.0)
    trust_weight_entailment: float = Field(default=0.20, ge=0.0, le=1.0)
    trust_weight_freshness: float = Field(default=0.10, ge=0.0, le=1.0)
    trust_weight_model_confidence: float = Field(default=0.20, ge=0.0, le=1.0)
    trust_abstain_threshold: float = Field(default=40.0, ge=0.0, le=100.0)
    trust_review_threshold: float = Field(default=65.0, ge=0.0, le=100.0)

    # -------------------------------------------------------- verification
    entailment_support_threshold: float = Field(default=0.55, ge=0.0, le=1.0)
    entailment_contradiction_threshold: float = Field(default=0.45, ge=0.0, le=1.0)
    max_claims_per_answer: int = Field(default=15, ge=1, le=50)

    # ------------------------------------------------------------- limits
    max_upload_mb: int = Field(default=25, ge=1, le=200)
    seed_mitre: bool = True

    @field_validator("google_api_key", mode="before")
    @classmethod
    def _blank_key_to_none(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @property
    def cors_origin_list(self) -> list[str]:
        return _split_csv(self.cors_origins)

    @property
    def cors_origin_regex_value(self) -> str | None:
        """Regex passed to Starlette's CORSMiddleware, or ``None`` when disabled."""
        pattern = (self.cors_origin_regex or "").strip()
        return pattern or None

    @property
    def gemini_model_list(self) -> list[str]:
        models = _split_csv(self.gemini_models)
        return models or ["gemini-3.5-flash-lite", "gemini-3.8-flash"]

    @property
    def gemini_enabled(self) -> bool:
        return bool(self.google_api_key)

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    @property
    def default_trust_weights(self) -> dict[str, float]:
        return {
            "provenance": self.trust_weight_provenance,
            "authority": self.trust_weight_authority,
            "relevance": self.trust_weight_relevance,
            "entailment": self.trust_weight_entailment,
            "freshness": self.trust_weight_freshness,
            "model_confidence": self.trust_weight_model_confidence,
        }

    # Expose the trust thresholds as a single read-only mapping for the API.
    @property
    def trust_thresholds(self) -> dict[str, float]:
        return {
            "abstain": self.trust_abstain_threshold,
            "review": self.trust_review_threshold,
            "support": self.entailment_support_threshold,
        }


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
