from typing import Literal

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from app.core.timeparse import parse_utc_at
from app.services.orbit import solar

router = APIRouter(prefix="/solar", tags=["solar"])


@router.get("/catalog")
def catalog(kind: Literal["", "planet", "asteroid", "comet"] = "", q: str = Query("", max_length=100),
            offset: int = Query(0, ge=0), limit: int = Query(35, ge=1, le=100)) -> dict:
    return solar.list_bodies(kind, q, offset, limit)


@router.get("/trajectory/{body_id}")
def trajectory(body_id: str, at: str = "", days: float | None = Query(None, ge=1, le=73050),
               points: int = Query(160, ge=20, le=400)) -> dict:
    return solar.trajectory(body_id, parse_utc_at(at), days, points)


class Lookup(BaseModel):
    designation: str = Field(min_length=1, max_length=80)


@router.post("/lookup")
def lookup(body: Lookup) -> dict:
    return solar.import_body(body.designation)
