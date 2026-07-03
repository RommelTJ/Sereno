# Sereno backend

FastAPI + SQLite, managed with [uv](https://docs.astral.sh/uv/). All commands are
normally run through Docker Compose from the repository root — see the
[root README](../README.md).

Layout:

- `src/sereno/api/` — HTTP routers
- `src/sereno/engine/` — pure financial engines (no FastAPI/DB imports)
- `src/sereno/db/` — SQLite access layer, migrations, seed
- `tests/` — pytest suite
