from langchain_core.output_parsers import StrOutputParser
from loguru import logger

from mlops_serious_game.application.message_parser import sanitize_dashes
from mlops_serious_game.application.pitch_debate_service.chains import get_chat_model
from mlops_serious_game.application.component_investigation_service.prompts import (
    GENERATE_COMPONENT_FACT_PROMPT,
    INVESTIGATION_PLAYER_UTTERANCE_PROMPT,
    INVESTIGATION_STAKEHOLDER_RESPONSE_PROMPT,
)

COMPONENT_FACT_FALLBACKS: dict[str, str] = {
    "req.kpi_definition": "Technical project logs show business KPIs lack formal mathematical formulas and automated telemetry mapping.",
    "req.acceptance_criteria": "Release criteria inspection indicates quality gates are evaluated manually without automated thresholds.",
    "req.data_contracts": "Interface telemetry confirms data producer schemas lack automated contract validation and breaking change alerts.",
    "req.risk_assessment": "Operational audit logs indicate model risk assessments are recorded offline without continuous compliance verification.",
    "data.ingestion": "Data ingestion pipeline telemetry indicates raw ingestion runs on unscheduled batch jobs without failure retry policies.",
    "data.validation": "Diagnostic logs confirm incoming data streams lack automated schema validation and drift checks before preprocessing.",
    "data.feature_store": "Feature store audit reveals offline training features and online serving definitions are calculated independently without parity verification.",
    "data.versioning": "Storage snapshots show training datasets are not pinned to immutable version tags across pipeline iterations.",
    "data.labeling": "Labeling pipeline telemetry indicates ground truth annotations lack inter-annotator consensus verification.",
    "data.training_drift_check": "Drift detection logs indicate statistical drift thresholds between training splits and production inputs are unconfigured.",
    "model.experiment_tracking": "Experiment tracking inspection reveals training parameters and loss metrics are saved in local notebooks without artifact lineage.",
    "model.registry": "Model registry inspection confirms candidate artifacts lack automated regression gating and approval signatures.",
    "model.training_pipeline": "Training pipeline runs show execution lacks automated checkpointing and fault-tolerant retry hooks.",
    "model.hpo": "Hyperparameter optimization logs show search jobs run sequentially without Bayesian early stopping.",
    "model.evaluation": "Evaluation harness logs show model candidates are scored only on aggregate accuracy without subgroup fairness or slice metrics.",
    "deploy.cicd": "Deployment pipeline traces confirm continuous delivery lacks automated canary release gates and rollback triggers.",
    "deploy.serving": "Inference service monitoring indicates serving instances lack dynamic autoscaling under peak traffic loads.",
    "deploy.orchestration": "Orchestration logs show container scheduling lacks resource quotas and automatic worker node failover.",
    "deploy.containerization": "Container builds show runtime base images lack automated vulnerability scanning and layer caching.",
    "ops.performance_monitoring": "Production observability metrics confirm inference latency and throughput degradation alerts are unconfigured.",
    "ops.observability": "System telemetry reveals distributed tracing across inference and data processing microservices is absent.",
    "ops.alerting": "Incident response logs show alert routing depends on manual escalation without automated paging rules.",
    "ops.rollback": "Rollback audit indicates recovery from faulty deployment requires manual container redeployment.",
    "gov.cost_monitoring": "Cloud infrastructure telemetry shows compute allocation lacks cost attribution per model training workload.",
    "gov.compute_scheduling": "Compute cluster metrics show GPU worker nodes experience high idle times without priority job queuing.",
    "gov.iac": "Infrastructure audit reveals cloud provisioning contains undocumented manual configurations outside IaC templates.",
    "gov.audit": "Audit trail logs show model deployment approvals and data access permissions are recorded in offline spreadsheets.",
    "gov.compliance_tracking": "Compliance telemetry confirms regulatory adherence and data retention policies lack automated validation.",
}


def get_investigation_player_utterance_chain():
    model = get_chat_model(temperature=0.7)
    return INVESTIGATION_PLAYER_UTTERANCE_PROMPT | model | StrOutputParser()


def get_investigation_stakeholder_response_chain():
    model = get_chat_model(temperature=0.7)
    return INVESTIGATION_STAKEHOLDER_RESPONSE_PROMPT | model | StrOutputParser()


def get_component_fact_chain():
    model = get_chat_model(temperature=0.4)
    return GENERATE_COMPONENT_FACT_PROMPT | model | StrOutputParser()


async def generate_investigation_player_utterance(
    challenge: str = "",
    target_stakeholder_name: str = "Stakeholder",
    target_stakeholder_role: str = "",
    component_id: str = "",
    component_name: str = "",
    dialogue_option_prompt: str = "",
    history: str = "",
    default_prompt: str = "",
) -> str:
    """Generates the player's spoken inquiry to the stakeholder regarding the investigated component."""
    fallback = (
        default_prompt
        or dialogue_option_prompt
        or f"Hi {target_stakeholder_name}, could you walk me through the current status and technical details of {component_name}?"
    )
    try:
        chain = get_investigation_player_utterance_chain()
        result = await chain.ainvoke(
            {
                "challenge": challenge,
                "target_stakeholder_name": target_stakeholder_name,
                "target_stakeholder_role": target_stakeholder_role,
                "component_id": component_id,
                "component_name": component_name,
                "dialogue_option_prompt": dialogue_option_prompt or fallback,
                "history": history,
            }
        )
        text = str(result).strip().strip('"').strip("'")
        text = sanitize_dashes(text)
        return text if text else sanitize_dashes(fallback)
    except Exception as exc:
        logger.warning(f"generate_investigation_player_utterance failed, falling back: {exc}")
        return sanitize_dashes(fallback)


async def generate_investigation_stakeholder_response(
    stakeholder_name: str = "Stakeholder",
    stakeholder_role: str = "",
    challenge: str = "",
    responsibilities: str = "",
    priorities: str = "",
    emotion: str = "Neutral",
    component_name: str = "",
    revealed_intel_description: str = "",
    revealed_intel_tag: str = "",
    history: str = "",
    player_utterance: str = "",
    default_response: str = "",
) -> str:
    """Generates the stakeholder's in-character response explaining the component finding."""
    fallback = (
        default_response
        or revealed_intel_description
        or f"Regarding {component_name}, here is what we are seeing: {revealed_intel_description}"
    )
    try:
        chain = get_investigation_stakeholder_response_chain()
        result = await chain.ainvoke(
            {
                "stakeholder_name": stakeholder_name,
                "stakeholder_role": stakeholder_role,
                "challenge": challenge,
                "responsibilities": responsibilities,
                "priorities": priorities,
                "emotion": emotion,
                "component_name": component_name,
                "revealed_intel_description": revealed_intel_description,
                "revealed_intel_tag": revealed_intel_tag,
                "history": history,
                "player_utterance": player_utterance,
            }
        )
        text = str(result).strip().strip('"').strip("'")
        text = sanitize_dashes(text)
        return text if text else sanitize_dashes(fallback)
    except Exception as exc:
        logger.warning(f"generate_investigation_stakeholder_response failed, falling back: {exc}")
        return sanitize_dashes(fallback)


async def generate_component_fact(
    challenge: str,
    component_id: str,
    component_name: str,
    component_group: str = "",
) -> str:
    """Generates an objective Fact intel observation about an MLOps component with safe fallbacks."""
    fallback = COMPONENT_FACT_FALLBACKS.get(
        component_id,
        f"Technical audit of {component_name} reveals operational constraints and missing automated verification gates in the current architecture.",
    )
    try:
        chain = get_component_fact_chain()
        result = await chain.ainvoke(
            {
                "challenge": challenge,
                "component_id": component_id,
                "component_name": component_name,
                "component_group": component_group,
            }
        )
        text = str(result).strip().strip('"').strip("'")
        text = sanitize_dashes(text)
        return text if text else fallback
    except Exception as exc:
        logger.warning(f"generate_component_fact failed, falling back to default: {exc}")
        return fallback
