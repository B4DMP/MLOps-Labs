

# 🚀 Installation and Usage Guide

This guide will help you set up and run the serious game.

# 📑 Table of Contents

- [📋 Prerequisites](#-prerequisites)
- [🎯 Getting Started](#-getting-started)
- [📁 Project Structure](#-project-structure)
- [🏗️ Set Up Your Local Infrastructure](#-set-up-your-local-infrastructure)
- [⚡️ Running the Code for Each Module](#️-running-the-code-for-each-module)
- [🔧 Utlity Commands](#-utility-commands)

# 📋 Prerequisites

## Local Tools

You'll need the following tools installed locally:

| Tool | Version | Purpose | Installation Link |
|------|---------|---------|------------------|
| Python | 3.11 | Programming language runtime | [Download](https://www.python.org/downloads/) |
| uv | ≥ 0.4.30 | Python package installer and virtual environment manager | [Download](https://github.com/astral-sh/uv) |
| GNU Make | ≥ 3.81 | Build automation tool | [Download](https://www.gnu.org/software/make/) |
| Git | ≥2.44.0 | Version control | [Download](https://git-scm.com/downloads) |
| Docker | ≥27.4.0 | Containerization platform | [Download](https://www.docker.com/get-started/) |

Windows users also need to install WSL

## Cloud Services

The game requires access to these cloud services. The authentication to these services is done by adding the corresponding environment variables to the `.env` file:

| Service | Purpose | Cost | Environment Variable | Setup Guide 
|---------|---------|------|---------------------|-------------|
| [Groq](https://rebrand.ly/mlops_serious_game-groq) / [WestAI](https://help.itc.rwth-aachen.de/service/1808737e10424937b76e564ed15d8028/) / MistralAI | LLM API that powers the agents | Free tier | `GROQ_API_KEY` / `WESTAI_API_KEY` / `MISTRAL_API_KEY` | [Quick Start Guide](https://rebrand.ly/mlops_serious_game-groq-quickstart) |
| [Opik](https://rebrand.ly/mlops_serious_game-opik) | LLMOps | Free tier (Hosted on Comet - same API Key) | `COMET_API_KEY` | [Quick Start Guide](https://rebrand.ly/mlops_serious_game-opik-quickstart) |

Note that WestAI is an OpenAI-compatible proxy hosted by the RWTH Aachen University. In theory, any OpenAI-compatible API can be used by modifying `WESTAI_API_BASE` or `MISTRAL_API_BASE` in config.py.

When working locally, the infrastructure is set up using Docker. Thus, you can use the default values found in the [config.py](mlops_serious_game-api/src/mlops_serious_game/config.py) file for all the infrastructure-related environment variables.

But, in case you want to deploy the code, you'll need to setup the following services with their corresponding environment variables:

| Service | Purpose | Cost | Required Credentials | Setup Guide |
| PostgreSQL | Relational database & vector store | Free / Self-hosted | `POSTGRES_URI`, `POSTGRES_ASYNC_URI` | Run PostgreSQL with pgvector via Docker Compose |

# 🎯 Getting Started

## 1. Clone the Repository

Start by cloning the repository and navigating to the `game-api` project directory.
Next, we have to prepare your Python environment and its dependencies.

## 2. Installation

Inside the `game-api` directory, to install the dependencies and activate the virtual environment, run the following commands:

```bash
uv venv .venv
. ./.venv/bin/activate # or source ./.venv/bin/activate
uv pip install -e .
```

Test that you have Python 3.11.9 installed in your new `uv` environment:
```bash
uv run python --version
# Output: Python 3.11.9
```

This command will:
- Create a virtual environment with the Python version specified in `.python-version` using `uv`
- Activate the virtual environment
- Install all dependencies from `pyproject.toml`

## 3. Environment Configuration

Before running any command, inside the `game-api` directory, you have to set up your environment:
1. Create your environment file:
   ```bash
   cp .env.example .env
   ```
2. Open `.env` and configure the required credentials following the inline comments and the recommendations from the [Cloud Services](#-prerequisites) section.

# 📁 Project Structure

The project is divided into two main applications and shared configuration:

```bash
.
├── game-api/              
│   ├── data/              # Stakeholder knowledge base and datasets
│   ├── src/mlops_serious_game/   # Core application logic
│   │   ├── application/   # Domain services (auth_service, admin_service, conversation_service)
│   │   ├── domain/        # Game domain models & factories
│   │   └── infrastructure/# API routes, PostgreSQL database layer, and unified WebSocket server
│   │       ├── routes/    # REST endpoints (/api/auth, /api/admin)
│   │       └── websocket/ # Unified WebSocket ConnectionManager, router (/ws), and event handlers
│   ├── tools/             # Entrypoint scripts and utility tools
│   ├── .env.example       # Environment variables template
│   ├── Dockerfile         # API Docker image definition
│   └── pyproject.toml     # Project dependencies
├── game-ui/               
│   ├── src/               # React components, styling, and services
│   │   └── services/      # REST API clients & WebSocketProvider context
│   ├── public/            # Static assets
│   └── Dockerfile         # UI Docker image definition
├── gameConfig/            # JSON files defining game phases, challenges, and metrics
└── Makefile               # Project commands
```


# 🏗️ Set Up Your Local Infrastructure

We use Docker to set up the local infrastructure (Game UI, Agent API, PostgreSQL with pgvector).

> [!WARNING]
> Before running the command below, ensure you do not have any processes running on ports `8000` (Agent API) and `5173` (Game UI).

From the root directory, to start the Docker infrastructure, run:
```bash
make infrastructure-up
```

From the root directory, to stop the Docker infrastructure, run:
```bash
make infrastructure-stop
```

From the root directory, to build the Docker images (without running them), run:
```bash
make infrastructure-build
```
To access the game, type the following into your browser:
```
http://localhost:5173
```

## Long Term Memory

From the root `MLOps Serious Game` directory, populate the long term memory within your PostgreSQL instance (required for agentic RAG with pgvector) with the following command:
```bash
make create-long-term-memory
```
To delete the long term memory from your PostgreSQL instance, you can run the following command:
```bash
make delete-long-term-memory
```
> [!NOTE]
> To visualize the raw and RAG data from PostgreSQL, we recommend using pgAdmin or DBeaver.
> The database port is **not published to the host** by default, so it does not clash with any other
> PostgreSQL you may be running. To attach a client, either open a shell on the container:
>
> ```bash
> docker compose exec postgres psql -U mlops_labs -d mlops_labs
> ```
>
> or publish the port temporarily by adding a `ports` entry (e.g. `"5433:5432"`) to the `postgres`
> service in [docker-compose.yml](docker-compose.yml) and connecting to `localhost:5433`
> with the credentials `mlops_labs` / `mlops_labs`.

## 🗄️ Database & Schema Migrations (PostgreSQL + Alembic)

### Managing Schema Changes with Alembic
Modifying SQLAlchemy model classes in `game-api/src/mlops_serious_game/infrastructure/database/models.py` does not automatically update live database tables. To update your PostgreSQL schema:

Alembic runs inside the `api` container, which is where the database is reachable
(PostgreSQL is not published to the host). The `alembic/` directory is mounted into the
container, so generated migration scripts appear in your working tree as usual.

1. **Autogenerate a new migration script**:
   ```bash
   docker compose exec api alembic revision --autogenerate -m "Describe your schema changes"
   ```
2. **Apply the migration to PostgreSQL**:
   ```bash
   docker compose exec api alembic upgrade head
   ```

## Agent Evaluation

We adapted the [PersonaGym evaluation tool](https://github.com/vsamuel2003/PersonaGym) to evaluate the consistency of our stakeholder representatives.

To run the evaluation for a specific stakeholder, use the following command:

```bash
make evaluate-agent NAME=eval_name STAKEHOLDER_ID=stakeholder_id
```

with eval_name being the name of the evaluation run and stakeholder_id being the integer id of the stakeholder. For evaluation all available stakeholders in sequence, use 

```bash
make evaluate-agent NAME=eval_name STAKEHOLDER_ID=-1
```

### Manual Testing

If you want to **directly call the agent bypassing the backend and UI logic**, you can do that by manually running the  [api_live_test.py](game-api\api_live_test.py).
For a static test, run [action_card_generation_test.py](game-api\action_card_generation_test.py)
### Test accounts per gameplay screen

To jump straight to a screen without playing up to it, seed one account per screen (password `test1234`, campaign `test-accounts`):

```bash
docker compose exec api python -m tools.seed_test_accounts
```

Logins are `test-{stage}@test.com` (first real phase) and `test-intro-{stage}@test.com` (starts in the demo phase, its own campaign). Stages: `questionnaire`, `briefing`, `phase-briefing`, `offline-intel`, `pitch`, `veto`, `simulation`, plus `outro-questionnaire` and `results` for the main family only. From `offline-intel` on, the dossier is partly filled (some notes found, a few tagged wrong). The `pitch` accounts also start with three stakeholders losing patience (one step, two steps, one step), to test the patience tag. Pass full account names (e.g. `pitch intro-pitch`) to reseed only those. Re-running resets every account in place to its position.
