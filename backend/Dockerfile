FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

WORKDIR /app
ENV UV_LINK_MODE=copy

# Install dependencies first so this layer caches across source changes.
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-install-project

COPY src ./src
COPY tests ./tests
RUN uv sync --frozen

EXPOSE 8000
CMD ["uv", "run", "uvicorn", "sereno.main:app", "--host", "0.0.0.0", "--port", "8000"]
