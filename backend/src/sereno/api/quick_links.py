"""Quick links: user-managed institution URLs, one click from the balance form.

Updating a month's balances means visiting each institution's website;
these rows put those URLs on the Ledger itself. They are navigation
utilities, not financial facts — no append-only history to protect — so
links are edited in place and hard-deleted, the one delete in the app.
"""

import sqlite3
from typing import Annotated, Self

from fastapi import APIRouter, Depends, HTTPException
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


class QuickLinkOrder(BaseModel):
    """The complete ordered list of quick link ids — total, so a partial
    update can never interleave two reorders."""

    ids: list[int]


@router.put("/quick-links/order")
def reorder_quick_links(order: QuickLinkOrder, db: Db) -> list[QuickLink]:
    """Persists a user-defined display order: position in the list becomes
    sort_order (1-based). Declared before /quick-links/{quick_link_id} so
    "order" is never parsed as a link id. No active flag here — every row
    renders, so the order covers every row."""
    all_ids = {row["id"] for row in db.execute("SELECT id FROM quick_link")}
    if len(order.ids) != len(all_ids) or set(order.ids) != all_ids:
        raise HTTPException(status_code=422, detail="ids must be exactly the quick link ids")
    db.executemany(
        "UPDATE quick_link SET sort_order = ? WHERE id = ?",
        list(enumerate(order.ids, start=1)),
    )
    db.commit()
    rows = db.execute("SELECT id, label, url FROM quick_link ORDER BY sort_order, id")
    return [QuickLink(**dict(row)) for row in rows]


def _require_quick_link(db: sqlite3.Connection, quick_link_id: int) -> None:
    if db.execute("SELECT 1 FROM quick_link WHERE id = ?", (quick_link_id,)).fetchone() is None:
        raise HTTPException(status_code=404, detail="quick link not found")


@router.put("/quick-links/{quick_link_id}")
def update_quick_link(quick_link_id: int, link: QuickLinkBody, db: Db) -> QuickLink:
    _require_quick_link(db, quick_link_id)
    db.execute(
        "UPDATE quick_link SET label = ?, url = ? WHERE id = ?",
        (link.label, link.url, quick_link_id),
    )
    db.commit()
    return _quick_link(db, quick_link_id)


@router.delete("/quick-links/{quick_link_id}", status_code=204)
def delete_quick_link(quick_link_id: int, db: Db) -> None:
    """A true hard delete — the one in the app. Every other removal is a
    soft flag because financial history must keep counting; a quick link
    has no facts attached, so there is nothing to keep."""
    _require_quick_link(db, quick_link_id)
    db.execute("DELETE FROM quick_link WHERE id = ?", (quick_link_id,))
    db.commit()
