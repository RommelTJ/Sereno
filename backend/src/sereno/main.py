from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from sereno import __version__
from sereno.api.balances import router as balances_router
from sereno.api.budget import router as budget_router
from sereno.api.config import router as config_router
from sereno.api.forecast import router as forecast_router
from sereno.api.funds import router as funds_router
from sereno.api.guardrails import router as guardrails_router
from sereno.api.health import router as health_router
from sereno.api.quick_links import router as quick_links_router
from sereno.api.sourcing import router as sourcing_router
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
app.include_router(config_router, prefix="/api")
app.include_router(forecast_router, prefix="/api")
app.include_router(funds_router, prefix="/api")
app.include_router(guardrails_router, prefix="/api")
app.include_router(quick_links_router, prefix="/api")
app.include_router(sourcing_router, prefix="/api")
