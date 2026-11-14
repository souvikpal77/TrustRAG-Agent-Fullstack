"""Domain-level exceptions mapped to consistent JSON error envelopes."""

from __future__ import annotations

from typing import Any


class AppError(Exception):
    """Base class for handled application errors."""

    status_code: int = 400
    code: str = "bad_request"

    def __init__(
        self,
        detail: str,
        *,
        status_code: int | None = None,
        code: str | None = None,
        context: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(detail)
        self.detail = detail
        if status_code is not None:
            self.status_code = status_code
        if code is not None:
            self.code = code
        self.context = context or {}


class NotFoundError(AppError):
    status_code = 404
    code = "not_found"


class ValidationAppError(AppError):
    status_code = 422
    code = "validation_error"


class UnsupportedMediaError(AppError):
    status_code = 415
    code = "unsupported_media_type"


class ConflictError(AppError):
    status_code = 409
    code = "conflict"


class UpstreamServiceError(AppError):
    status_code = 502
    code = "upstream_error"


class ServiceUnavailableError(AppError):
    status_code = 503
    code = "service_unavailable"


class PayloadTooLargeError(AppError):
    status_code = 413
    code = "payload_too_large"
