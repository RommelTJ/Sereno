"""The spend band slice: the age-banded spend schedule as versioned,
append-only config. A save is a version — a spend_band_version row with
the band rows hanging off it — and reads resolve the latest version
effective on or before today, ties broken by insertion order, the same
rule as every other config table. Years the schedule does not cover
fall back to the spend plan's annual_target, so an empty list (whether
unconfigured or deliberately cleared) simply means flat spending. The
validation is shared with the forecast's transient band= override: the
save and the what-if reject identically, and rejecting before any
insert keeps a bad save from writing even its version row.
"""

import sqlite3
from collections.abc import Sequence
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from sereno.api.sourcing import current_age
from sereno.db.connection import get_db
from sereno.engine.forecast import END_AGE

router = APIRouter()

Db = Annotated[sqlite3.Connection, Depends(get_db)]

_EFFECTIVE_VERSION = (
    "SELECT id FROM spend_band_version WHERE effective_date <= ?"
    " ORDER BY effective_date DESC, id DESC LIMIT 1"
)

_VERSION_BANDS = (
    "SELECT id, start_year, end_year, annual_amount, note FROM spend_band"
    " WHERE version_id = ? ORDER BY start_year"
)


class SpendBand(BaseModel):
    id: int
    start_year: int
    end_year: int | None
    annual_amount: float
    note: str | None


class SpendBandCreate(BaseModel):
    start_year: int
    end_year: int | None = None
    annual_amount: float = Field(ge=0)
    note: str | None = None


class SpendScheduleCreate(BaseModel):
    effective_date: date
    bands: list[SpendBandCreate]


def band_label(start_year: int, end_year: int | None) -> str:
    return f"{start_year}+" if end_year is None else f"{start_year}-{end_year}"


def validate_bands(ranges: Sequence[tuple[int, int | None]]) -> None:
    """The shared band rules over inclusive calendar-year ranges (end
    None = open-ended). A band may start in the past while it still
    covers this year — that is a schedule aging forward — but a band
    entirely behind us or starting past the age-100 horizon is a typo,
    the same stance _parse_purchases takes on purchase years."""
    today = date.today()
    age_offset = current_age() - today.year
    for start, end in ranges:
        if end is not None and end < start:
            detail = f"band {band_label(start, end)} ends before it starts"
            raise HTTPException(status_code=422, detail=detail)
        if end is not None and end < today.year:
            detail = f"band {band_label(start, end)} is in the past"
            raise HTTPException(status_code=422, detail=detail)
        if start + age_offset > END_AGE:
            detail = f"band {band_label(start, end)} falls beyond age {END_AGE}"
            raise HTTPException(status_code=422, detail=detail)
    ordered = sorted(ranges, key=lambda band: band[0])
    for (start_a, end_a), (start_b, end_b) in zip(ordered, ordered[1:], strict=False):
        if end_a is None or start_b <= end_a:
            detail = f"bands {band_label(start_a, end_a)} and {band_label(start_b, end_b)} overlap"
            raise HTTPException(status_code=422, detail=detail)


def effective_schedule(db: sqlite3.Connection) -> list[SpendBand]:
    """The effective version's rows, start-year ordered — the schedule
    the forecast applies when no transient override rides along."""
    row = db.execute(_EFFECTIVE_VERSION, (date.today().isoformat(),)).fetchone()
    if row is None:
        return []
    return [SpendBand(**dict(band)) for band in db.execute(_VERSION_BANDS, (row["id"],))]


@router.get("/spend-bands")
def get_spend_bands(db: Db) -> list[SpendBand]:
    return effective_schedule(db)


@router.post("/spend-bands", status_code=201)
def create_spend_bands(schedule: SpendScheduleCreate, db: Db) -> list[SpendBand]:
    validate_bands([(band.start_year, band.end_year) for band in schedule.bands])
    cursor = db.execute(
        "INSERT INTO spend_band_version (effective_date) VALUES (?)",
        (schedule.effective_date.isoformat(),),
    )
    version_id = cursor.lastrowid
    for band in schedule.bands:
        db.execute(
            "INSERT INTO spend_band (version_id, start_year, end_year, annual_amount, note)"
            " VALUES (?, ?, ?, ?, ?)",
            (version_id, band.start_year, band.end_year, band.annual_amount, band.note),
        )
    db.commit()
    return [SpendBand(**dict(row)) for row in db.execute(_VERSION_BANDS, (version_id,))]
