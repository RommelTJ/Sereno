from fastapi import APIRouter
from pydantic import BaseModel

from sereno import __version__

router = APIRouter()


class Health(BaseModel):
    status: str
    version: str


@router.get("/health")
def health() -> Health:
    return Health(status="ok", version=__version__)
