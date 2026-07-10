"""Quick links: user-managed institution URLs, one click from the balance form.

Updating a month's balances means visiting each institution's website;
these rows put those URLs on the Ledger itself. They are navigation
utilities, not financial facts — no append-only history to protect — so
links are edited in place and hard-deleted, the one delete in the app.
"""

import sqlite3
from typing import Annotated, Self

from fastapi import APIRouter, Depends
from pydantic import BaseModel, StringConstraints, model_validator

from sereno.db.connection import get_db

router = APIRouter()

Db = Annotated[sqlite3.Connection, Depends(get_db)]


class QuickLink(BaseModel):
    id: int
    label: str
    url: str


class QuickLinkBody(BaseModel):
    """A schemeless URL gets https:// prefixed — everything else (host,
    path, query) is stored verbatim — so the link opens absolutely instead
    of resolving relative to the app."""

    label: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    url: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]

    @model_validator(mode="after")
    def prefix_missing_scheme(self) -> Self:
        if not self.url.startswith(("http://", "https://")):
            self.url = f"https://{self.url}"
        return self


def _quick_link(db: sqlite3.Connection, quick_link_id: int | None) -> QuickLink:
    row = db.execute(
        "SELECT id, label, url FROM quick_link WHERE id = ?", (quick_link_id,)
    ).fetchone()
    return QuickLink(**dict(row))


@router.get("/quick-links")
def list_quick_links(db: Db) -> list[QuickLink]:
    rows = db.execute("SELECT id, label, url FROM quick_link ORDER BY sort_order, id")
    return [QuickLink(**dict(row)) for row in rows]


@router.post("/quick-links", status_code=201)
def create_quick_link(link: QuickLinkBody, db: Db) -> QuickLink:
    """New links append at the end of the user's order (MAX + 1 — the
    sort_order convention from migration 0009)."""
    cursor = db.execute(
        "INSERT INTO quick_link (label, url, sort_order)"
        " VALUES (?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM quick_link))",
        (link.label, link.url),
    )
    db.commit()
    return _quick_link(db, cursor.lastrowid)
