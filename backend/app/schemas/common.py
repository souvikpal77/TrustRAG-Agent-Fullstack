"""Common response envelopes and health schemas."""

from __future__ import annotations

from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field

T = TypeVar("T")


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class MessageResponse(BaseModel):
    message: str


class PaginatedResponse(BaseModel, Generic[T]):
    items: list[T]
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: int = Field(ge=1)


class HealthResponse(BaseModel):
    status: str
    database: str
    version: str
    environment: str
    gemini_configured: bool
    offline_fallback: bool


class RuntimeMetaResponse(BaseModel):
    app_name: str
    version: str
    environment: str
    gemini_configured: bool
    gemini_models: list[str]
    embedding_provider: str
    chunking: dict[str, int]
    retrieval: dict[str, float | int]
    trust: dict[str, object]
    mitre_techniques: int
