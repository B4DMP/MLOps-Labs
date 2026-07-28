ifeq (,$(wildcard game-api/.env))
$(error .env file is missing at game-api/.env. Please create one based on .env.example)
endif

include game-api/.env

# --- Infrastructure ---

infrastructure-build:
	docker compose build

infrastructure-up:
	docker compose up --build -d

infrastructure-stop:
	docker compose stop

check-docker-image:
	@if [ -z "$$(docker images -q game-api 2> /dev/null)" ]; then \
		echo "Error: game-api Docker image not found."; \
		echo "Please run 'make infrastructure-build' first to build the required images."; \
		exit 1; \
	fi

# --- Offline Pipelines ---

call-agent: check-docker-image
	docker run --rm --network=philoagents-network --env-file game-api/.env -e PYTHONPATH=//app/tools -e POSTGRES_URI="postgresql+psycopg://mlops_labs:mlops_labs@postgres:5432/mlops_labs" -e POSTGRES_ASYNC_URI="postgresql+asyncpg://mlops_labs:mlops_labs@postgres:5432/mlops_labs" -v ./game-api/data://app/data -v ./gameConfig://gameConfig -v ./game-api/src/philoagents://app/philoagents -v ./game-api/tools://app/tools game-api python -m tools.call_agent --challenge "A generic MLOps challenge" --query "What would be an action that conforms to company guidelines?."

create-long-term-memory: check-docker-image
	docker run --rm --network=philoagents-network --env-file game-api/.env -e PYTHONPATH=//app/tools -e POSTGRES_URI="postgresql+psycopg://mlops_labs:mlops_labs@postgres:5432/mlops_labs" -e POSTGRES_ASYNC_URI="postgresql+asyncpg://mlops_labs:mlops_labs@postgres:5432/mlops_labs" -v ./game-api/data://app/data -v ./gameConfig://gameConfig -v ./game-api/src/philoagents://app/philoagents -v ./game-api/tools://app/tools game-api python -m tools.create_long_term_memory

delete-long-term-memory: check-docker-image
	docker run --rm --network=philoagents-network --env-file game-api/.env -e PYTHONPATH=//app/tools -e POSTGRES_URI="postgresql+psycopg://mlops_labs:mlops_labs@postgres:5432/mlops_labs" -e POSTGRES_ASYNC_URI="postgresql+asyncpg://mlops_labs:mlops_labs@postgres:5432/mlops_labs" -v ./gameConfig://gameConfig -v ./game-api/src/philoagents://app/philoagents -v ./game-api/tools://app/tools game-api python -m tools.delete_long_term_memory

generate-evaluation-dataset: check-docker-image
	docker run --rm --network=philoagents-network --env-file game-api/.env -e PYTHONPATH=//app/tools -e POSTGRES_URI="postgresql+psycopg://mlops_labs:mlops_labs@postgres:5432/mlops_labs" -e POSTGRES_ASYNC_URI="postgresql+asyncpg://mlops_labs:mlops_labs@postgres:5432/mlops_labs" -v ./game-api/data://app/data -v ./gameConfig://gameConfig -v ./game-api/src/philoagents://app/philoagents -v ./game-api/tools://app/tools game-api python -m tools.generate_evaluation_dataset --max-samples 15

NAME ?= stakeholder_evaluation
STAKEHOLDER_ID ?= -1

evaluate-agent:
	docker run --rm --network=philoagents-network --env-file game-api/.env -e PYTHONPATH=//app/tools -e POSTGRES_URI="postgresql+psycopg://mlops_labs:mlops_labs@postgres:5432/mlops_labs" -e POSTGRES_ASYNC_URI="postgresql+asyncpg://mlops_labs:mlops_labs@postgres:5432/mlops_labs" -v ./game-api/data://app/data -v ./gameConfig://gameConfig -v ./game-api/src/philoagents://app/philoagents -v ./game-api/tools://app/tools game-api python -m tools.evaluate_agent --name $(NAME) --stakeholder_id $(STAKEHOLDER_ID)