from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from sereno import __version__
from sereno.api.balances import router as balances_router
from sereno.api.budget import router as budget_router
from sereno.api.health import router as health_router
from sereno.db.connection import connect
from sereno.db.migrations import migrate


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    conn = connect()
    try:
        migrate(conn)
    finally:
        conn.close()
    yield


app = FastAPI(title="Sereno", version=__version__, lifespan=lifespan)
app.include_router(health_router, prefix="/api")
app.include_router(balances_router, prefix="/api")
app.include_router(budget_router, prefix="/api")
