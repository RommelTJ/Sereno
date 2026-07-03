from fastapi import FastAPI

from sereno import __version__
from sereno.api.health import router as health_router

app = FastAPI(title="Sereno", version=__version__)
app.include_router(health_router, prefix="/api")
