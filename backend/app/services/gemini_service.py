"""Official ``google-genai`` SDK wrapper with multi-model fallback resilience."""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any, TypeVar

from pydantic import BaseModel

from app.core.config import Settings, settings as default_settings
from app.core.exceptions import ServiceUnavailableError, UpstreamServiceError

logger = logging.getLogger(__name__)

SchemaT = TypeVar("SchemaT", bound=BaseModel)

_JSON_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$", re.MULTILINE)

# After a model exceeds the per-request timeout, skip it for this long so later
# calls in the same process go straight to the next model in the chain.
_MODEL_TIMEOUT_COOLDOWN_SECONDS = 120.0


def _load_genai_types() -> Any:
    """Import the SDK types module once, away from the event loop."""
    from google.genai import types

    return types


@dataclass(slots=True)
class GeminiResult:
    text: str
    model: str
    degraded: bool = False
    parsed: dict[str, Any] | None = None
    errors: list[str] = field(default_factory=list)


def _is_retryable(error: Exception) -> bool:
    message = f"{type(error).__name__}: {error}".lower()
    return any(
        token in message
        for token in ("429", "500", "502", "503", "504", "rate limit", "timeout", "deadline", "unavailable", "overloaded")
    )


def parse_json_object(text: str) -> dict[str, Any]:
    cleaned = _JSON_FENCE.sub("", text).strip()
    try:
        value = json.loads(cleaned)
        if isinstance(value, dict):
            return value
        return {"items": value}
    except json.JSONDecodeError:
        # Recover the first complete JSON object in a noisy response.
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start != -1 and end > start:
            try:
                value = json.loads(cleaned[start : end + 1])
                if isinstance(value, dict):
                    return value
            except json.JSONDecodeError:
                pass
    return {}


class GeminiService:
    def __init__(self, config: Settings | None = None) -> None:
        self._settings = config or default_settings
        self._client: Any | None = None
        self._import_failed = False
        self._model_cooldown: dict[str, float] = {}

    @property
    def configured(self) -> bool:
        return bool(self._settings.google_api_key) and not self._import_failed

    @property
    def models(self) -> list[str]:
        return self._settings.gemini_model_list

    def _get_client(self) -> Any | None:
        if not self._settings.google_api_key or self._import_failed:
            return None
        if self._client is None:
            try:
                from google import genai

                self._client = genai.Client(api_key=self._settings.google_api_key)
            except Exception as exc:  # pragma: no cover - import/runtime guard
                logger.error("Unable to initialise Google GenAI client: %s", exc)
                self._import_failed = True
                return None
        return self._client

    def prewarm(self) -> bool:
        """Import the SDK and build the client away from the event loop.

        The first ``google-genai`` import can take several seconds on a cold
        process. Running it during startup keeps the first user request (and the
        ``/health`` poller) from stalling on that one-time cost.
        """
        return self._get_client() is not None

    def _without_cooling_models(self, models: list[str]) -> list[str]:
        now = time.monotonic()
        ready = [model for model in models if self._model_cooldown.get(model, 0.0) <= now]
        if ready:
            skipped = [model for model in models if model not in ready]
            if skipped:
                logger.info("Skipping cooling Gemini model(s): %s", ", ".join(skipped))
            return ready
        # Everything is cooling down: try the full chain rather than fail fast.
        return models

    async def generate(
        self,
        *,
        prompt: str,
        system_instruction: str,
        temperature: float | None = None,
        response_schema: type[BaseModel] | None = None,
        model_override: str | None = None,
        max_output_tokens: int | None = None,
    ) -> GeminiResult:
        # Offload the one-time SDK import/client construction; it can take
        # seconds on a cold process and must not block the event loop.
        client = await asyncio.to_thread(self._get_client)
        if client is None:
            raise ServiceUnavailableError(
                "Gemini is not configured. Set GOOGLE_API_KEY (or GEMINI_API_KEY) on the server to enable generation."
            )

        types = await asyncio.to_thread(_load_genai_types)

        models = [model_override] if model_override else []
        models.extend(model for model in self.models if model not in models)
        models = self._without_cooling_models(models)
        errors: list[str] = []

        config = types.GenerateContentConfig(
            system_instruction=system_instruction,
            temperature=(
                self._settings.gemini_temperature if temperature is None else temperature
            ),
            max_output_tokens=max_output_tokens or self._settings.gemini_max_output_tokens,
            response_mime_type="application/json" if response_schema else "text/plain",
            response_schema=response_schema,
        )

        for model in models:
            for attempt in range(self._settings.gemini_max_retries + 1):
                try:
                    response = await asyncio.wait_for(
                        client.aio.models.generate_content(
                            model=model, contents=prompt, config=config
                        ),
                        timeout=self._settings.gemini_timeout_seconds,
                    )
                    text = getattr(response, "text", None) or ""
                    if not text.strip():
                        raise UpstreamServiceError("Gemini returned an empty response")
                    parsed: dict[str, Any] | None = None
                    if response_schema is not None:
                        parsed = parse_json_object(text)
                        if not parsed:
                            raise UpstreamServiceError("Gemini returned malformed JSON")
                    logger.info("Gemini generation succeeded with model=%s", model)
                    return GeminiResult(
                        text=text.strip(),
                        model=model,
                        degraded=False,
                        parsed=parsed,
                        errors=errors,
                    )
                except Exception as exc:  # noqa: BLE001 - facade must be resilient
                    message = f"{model}: {type(exc).__name__}: {exc}"
                    errors.append(message[:500])
                    logger.warning("Gemini attempt failed (%s)", message[:300])
                    if attempt < self._settings.gemini_max_retries and _is_retryable(exc):
                        # A timeout means this model is too slow for the caller's
                        # latency budget; retrying the same model just multiplies
                        # the delay. Move straight to the next model in the chain.
                        if isinstance(exc, TimeoutError):
                            self._model_cooldown[model] = (
                                time.monotonic() + _MODEL_TIMEOUT_COOLDOWN_SECONDS
                            )
                            break
                        await asyncio.sleep(1.2 * (attempt + 1))
                        continue
                    break

        raise UpstreamServiceError(
            "All Gemini models in the fallback chain failed.",
            context={"errors": errors[-6:]},
        )


_gemini_service: GeminiService | None = None


def get_gemini_service() -> GeminiService:
    global _gemini_service
    if _gemini_service is None:
        _gemini_service = GeminiService()
    return _gemini_service
