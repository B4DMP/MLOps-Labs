ifeq (,$(wildcard .env))
$(error .env file is missing. Please create one based on .env.example)
endif

include .env

CHECK_DIRS := .

# --- QA ---

format-fix:
	uv run ruff format $(CHECK_DIRS) 
	uv run ruff check --select I --fix

lint-fix:
	uv run ruff check --fix

format-check:
	uv run ruff format --check $(CHECK_DIRS) 
	uv run ruff check -e
	uv run ruff check --select I -e

lint-check:
	uv run ruff check $(CHECK_DIRS)

# --- Content ---
# Generation uses Qwen on WestAI (quality); validation uses whatever provider is configured.

generate-items:
	uv run python -m content_gen --scope tier0 --provider westai run --stage items

generate-artifacts:
	uv run python -m content_gen --scope tier0 --provider westai run --stage artifacts

generate-objections:
	uv run python -m content_gen --scope tier0 --provider westai run --stage objections

assemble-content:
	uv run python -m content_gen --scope tier0 assemble

assemble-content-dry:
	uv run python -m content_gen --scope tier0 assemble --dry-run

validate-content:
	uv run python -m content_gen validate

validate-content-tier0:
	uv run python -m content_gen --scope tier0 validate
