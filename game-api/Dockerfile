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
COPY --from=gameconfig . /gameConfig

# Install current package without reinstalling dependencies.
RUN --mount=type=cache,target=/root/.cache/uv \
    uv pip install --system --no-deps -e .

CMD ["fastapi", "dev", "mlops_serious_game/infrastructure/api.py", "--port", "8000", "--host", "0.0.0.0"]
