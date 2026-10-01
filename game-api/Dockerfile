FROM python:3.11-slim

# Install uv.
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Set the working directory.
WORKDIR /app

# Install dependencies (cached unless pyproject.toml changes).
COPY pyproject.toml README.md ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv pip install --system -r pyproject.toml

# Copy application source files.
COPY src/mlops_serious_game mlops_serious_game/
COPY tools tools/
# Needed at startup: the API applies pending revisions itself.
COPY alembic.ini ./
COPY alembic alembic/
COPY --from=gameconfig . /gameConfig

# So the admin panel can show which build is actually running (verifying a restart/repull
# actually picked up a new image), not just that *a* container is up.
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA

# Install current package without reinstalling dependencies.
RUN --mount=type=cache,target=/root/.cache/uv \
    uv pip install --system --no-deps -e .

CMD ["fastapi", "dev", "mlops_serious_game/infrastructure/api.py", "--port", "8000", "--host", "0.0.0.0"]
