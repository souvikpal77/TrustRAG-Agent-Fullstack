"""FastAPI dependencies."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Header, Query

from app.services.audit_service import actor_from_header


def get_actor(x_actor: Annotated[str | None, Header(alias="X-Actor")] = None) -> str:
    """Identify the acting analyst for the audit trail.

    This is a label, not an authentication mechanism. Deploy behind your SSO /
    reverse proxy and forward the authenticated principal in ``X-Actor``.
    """
    return actor_from_header(x_actor)


class Pagination:
    def __init__(
        self,
        page: Annotated[int, Query(ge=1, le=10000)] = 1,
        page_size: Annotated[int, Query(ge=1, le=100)] = 20,
    ) -> None:
        self.page = page
        self.page_size = page_size
        self.offset = (page - 1) * page_size


Actor = Annotated[str, Depends(get_actor)]
PaginationParams = Annotated[Pagination, Depends()]
