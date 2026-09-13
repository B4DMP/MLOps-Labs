"""Add layout (x, y) coordinates to each component in MlopsGraph.json.

Coordinate system: each stage has a ~700x320 SVG viewport.
Components are 100x38px boxes; these are centre-x, centre-y.
"""
import json, pathlib

GRAPH = pathlib.Path('/gameConfig/MlopsGraph.json')

LAYOUT = {
    # req — Requirements (4 components, 2x2 grid)
    "req.kpi_definition":        {"x": 100, "y": 100},
    "req.acceptance_criteria":   {"x": 300, "y": 100},
    "req.risk_assessment":       {"x": 100, "y": 220},
    "req.data_contracts":        {"x": 300, "y": 220},

    # data — Data (6 components: main pipeline top, labeling + drift bottom)
    "data.ingestion":              {"x":  80, "y": 100},
    "data.validation":             {"x": 240, "y": 100},
    "data.versioning":             {"x": 400, "y": 100},
    "data.feature_store":          {"x": 560, "y": 100},
    "data.labeling":               {"x":  80, "y": 220},
    "data.training_drift_check":   {"x": 400, "y": 220},

    # model — Modeling (5 components)
    "model.hpo":                  {"x":  80, "y": 220},
    "model.training_pipeline":    {"x": 240, "y": 140},
    "model.experiment_tracking":  {"x": 420, "y": 220},
    "model.evaluation":           {"x": 420, "y":  80},
    "model.registry":             {"x": 580, "y": 140},

    # deploy — Deployment (7 components, 2 rows)
    "deploy.containerization": {"x":  80, "y":  90},
    "deploy.cicd":             {"x": 240, "y":  90},
    "deploy.orchestration":    {"x":  80, "y": 210},
    "deploy.serving":          {"x": 400, "y":  90},
    "deploy.api_gateway":      {"x": 560, "y":  90},
    "deploy.canary_ab":        {"x": 400, "y": 210},
    "deploy.shadow":           {"x": 560, "y": 210},

    # ops — Monitoring and Ops (6 components, 2 rows)
    "ops.performance_monitoring":      {"x":  80, "y": 100},
    "ops.production_drift_monitoring": {"x": 260, "y": 100},
    "ops.alerting":                    {"x": 440, "y": 100},
    "ops.observability":               {"x":  80, "y": 220},
    "ops.rollback":                    {"x": 260, "y": 220},
    "ops.retraining_trigger":          {"x": 440, "y": 220},

    # gov — Governance and Infra (6 components, 2 rows)
    "gov.iam":                {"x":  80, "y": 100},
    "gov.audit":              {"x": 240, "y": 100},
    "gov.model_cards":        {"x": 400, "y": 100},
    "gov.iac":                {"x":  80, "y": 220},
    "gov.compute_scheduling": {"x": 240, "y": 220},
    "gov.cost_monitoring":    {"x": 400, "y": 220},
}

data = json.loads(GRAPH.read_text())

missing = []
for comp in data['components']:
    cid = comp['id']
    if cid in LAYOUT:
        comp['layout'] = LAYOUT[cid]
    else:
        missing.append(cid)

if missing:
    print(f"WARNING: no layout defined for: {missing}")
else:
    print(f"OK: all {len(data['components'])} components have layout coords")

GRAPH.write_text(json.dumps(data, indent=2, ensure_ascii=False))
print("Written to", GRAPH)
