"""Dense embeddings.

Default provider is a deterministic local feature-hashing embedder, which keeps
ingestion and retrieval fully functional offline. When ``EMBEDDING_PROVIDER``
is set to ``gemini`` and an API key is configured, embeddings are produced by
the official ``google-genai`` SDK instead. Both paths return L2-normalised
vectors so cosine similarity reduces to a dot product.
"""

from __future__ import annotations

import hashlib
import logging
import math
import re
from collections import Counter
from functools import lru_cache
from typing import Any

import numpy as np

from app.core.config import Settings, settings as default_settings
from app.services.text import tokenize

logger = logging.getLogger(__name__)

_CHAR_NGRAM_RE = re.compile(r"[a-zA-Z0-9]")


def _hash_index(token: str, dimensions: int) -> int:
    digest = hashlib.blake2b(token.encode("utf-8"), digest_size=8).digest()
    return int.from_bytes(digest, "big") % dimensions


def _hashing_vector(text: str, dimensions: int) -> list[float]:
    vector = np.zeros(dimensions, dtype=np.float32)
    tokens = tokenize(text)
    if not tokens:
        vector[0] = 1.0
        return vector.tolist()

    counts = Counter(tokens)
    for token, count in counts.items():
        index = _hash_index(token, dimensions)
        weight = 1.0 + math.log(count)
        vector[index] += weight
        # Signed hashing reduces collisions between unrelated features.
        sign = 1.0 if int(hashlib.blake2b(token.encode("utf-8"), digest_size=1).hexdigest(), 16) % 2 else -1.0
        vector[index] += 0.15 * sign

    # Character 4-grams provide sub-word robustness for domains/hash fragments.
    for token in tokens:
        if len(token) < 5:
            continue
        for start in range(0, len(token) - 3):
            gram = token[start : start + 4]
            if _CHAR_NGRAM_RE.search(gram):
                vector[_hash_index(f"#{gram}", dimensions)] += 0.08

    norm = float(np.linalg.norm(vector))
    if norm > 0:
        vector /= norm
    return vector.tolist()


def _normalise(values: list[float]) -> list[float]:
    array = np.asarray(values, dtype=np.float32)
    norm = float(np.linalg.norm(array))
    if norm <= 0 or not math.isfinite(norm):
        return [0.0] * len(values)
    return (array / norm).tolist()


class EmbeddingService:
    def __init__(self, config: Settings | None = None) -> None:
        self._settings = config or default_settings
        self._client: Any | None = None
        self._gemini_unavailable = False

    @property
    def dimensions(self) -> int:
        return self._settings.embedding_dimensions

    @property
    def provider(self) -> str:
        return self._settings.embedding_provider

    def _get_client(self) -> Any | None:
        if not self._settings.google_api_key or self._gemini_unavailable:
            return None
        if self._client is None:
            try:
                from google import genai

                self._client = genai.Client(api_key=self._settings.google_api_key)
            except Exception:  # pragma: no cover - defensive import guard
                logger.exception("Unable to initialise Gemini client for embeddings")
                self._gemini_unavailable = True
                return None
        return self._client

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        if self.provider == "gemini":
            vectors = await self._embed_with_gemini(texts)
            if vectors is not None:
                return vectors
            logger.warning(
                "Gemini embeddings unavailable; falling back to deterministic hashing embedder"
            )
        return [_hashing_vector(text, self.dimensions) for text in texts]

    async def embed_query(self, text: str) -> list[float]:
        vectors = await self.embed_texts([text])
        return vectors[0] if vectors else [0.0] * self.dimensions

    async def _embed_with_gemini(self, texts: list[str]) -> list[list[float]] | None:
        client = self._get_client()
        if client is None:
            return None
        try:
            from google.genai import types

            response = await client.aio.models.embed_content(
                model=self._settings.gemini_embedding_model,
                contents=texts,
                config=types.EmbedContentConfig(
                    output_dimensionality=self._settings.embedding_dimensions
                ),
            )
            embeddings = getattr(response, "embeddings", None) or []
            vectors = [list(embedding.values or []) for embedding in embeddings]
            if len(vectors) != len(texts) or any(not vector for vector in vectors):
                return None
            return [_normalise(vector) for vector in vectors]
        except Exception:
            logger.exception("Gemini embedding request failed")
            self._gemini_unavailable = True
            return None

    @staticmethod
    def cosine(left: list[float], right: list[float]) -> float:
        if not left or not right or len(left) != len(right):
            return 0.0
        a = np.asarray(left, dtype=np.float32)
        b = np.asarray(right, dtype=np.float32)
        denominator = float(np.linalg.norm(a) * np.linalg.norm(b))
        if denominator <= 0:
            return 0.0
        return float(np.clip(np.dot(a, b) / denominator, 0.0, 1.0))


@lru_cache
def get_embedding_service() -> EmbeddingService:
    return EmbeddingService()
