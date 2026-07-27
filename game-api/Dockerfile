FROM python:3.11-slim

# Install uv.
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Set the working directory.
WORKDIR /app

# Install the application dependencies.
COPY pyproject.toml README.md ./
RUN uv pip install --no-cache --system torch --index-url https://download.pytorch.org/whl/cpu
# Copy the application into the container.
COPY src/philoagents philoagents/
COPY tools tools/
COPY --from=gameconfig . /gameConfig

RUN uv pip install --no-cache --system .

CMD ["fastapi", "run", "philoagents/infrastructure/api.py", "--port", "8000", "--host", "0.0.0.0"]
