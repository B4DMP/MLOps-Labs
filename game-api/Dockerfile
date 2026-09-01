FROM python:3.11-slim

# Install uv.
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Set the working directory.
WORKDIR /app

# Install the application dependencies (before copying source for better caching).
COPY pyproject.toml README.md ./
RUN uv pip install --no-cache --system torch --index-url https://download.pytorch.org/whl/cpu
RUN uv pip install --no-cache --system .

# Copy the application into the container (cache-busts only cheap COPY layers on code changes).
COPY src/mlops_serious_game mlops_serious_game/
COPY tools tools/
COPY --from=gameconfig . /gameConfig

CMD ["fastapi", "run", "mlops_serious_game/infrastructure/api.py", "--port", "8000", "--host", "0.0.0.0"]
