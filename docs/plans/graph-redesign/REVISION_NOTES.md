# Revision Notes

## Plan 00
We should iterate and more clearly define the fog-of war idea. If intel items can be facts this could be usable - it could represent that the PM (=the player) does not know all technical properties of their project environment from the start and needs to spend some time looking them up (similarly to the stakeholder's stances).

## Plan 01

Change the graph architecture from a hierarchical table to a real graph. This means that you should introduce the "Graph edges as mechanics" items from the backlog. Graph edges should represent connections between components, meaning workflows or pipelines (if the workflow is automated). Edges should store a level of maturity, and a trigger event, that replaces the cadence attribute that is currently held by the components.  Distinguish between a high level graph that stores component health and is visualized in the frontend, and a technical graph that holds the actual component properties, pipeline-steps and levels. Component health in the high-level graph should be based on antipatterns and inferred from the technical graph. This way level capping and degradation propagation should be represented/simulated.

The current plan (V1) provides for the following MLOps components: requirements, data, features, model deployment, serving and monitoring. This maps directly to the stakeholder but does not suffice for a complete representation of a technical MLOps environment. This is an example for the set of components that could be used.

### Data

- **Data Ingestion / Collection Pipeline**
- **Data Validation** 
- **Feature Store**
- **Data Versioning** 
- **Data Labeling Pipeline**
- **Data Drift Detection**

### Modeling

- **Experiment Tracking** 
- **Model Registry**
- **Model Versioning**
- **Training Pipeline / Orchestration**
- **Hyperparameter Tuning Service**
- **Model Validation / Evaluation Harness**

### Deployment

- **CI/CD Pipeline** 
- **Model Serving / Inference Endpoint**
- **A/B Testing / Canary Deployment Infrastructure**
- **Shadow Deployment**
- **Containerization** 
- **Orchestration** 
- **API Gateway**

### Monitoring & Operations

- **Model Performance Monitoring**
- **Data Drift / Concept Drift Monitoring** 
- **Alerting System**
- **Logging & Observability Stack**
- **Retraining Trigger / Automated Retraining Pipeline**
- **Rollback Mechanism**

### Governance & Infrastructure

- **Access Control / IAM**
- **Audit Logging / Compliance Tracking**
- **Model Documentation / Model Cards**
- **Cost Monitoring**
- **Infrastructure-as-Code**
- **Resource Scheduling / Compute Orchestration**

## Plan 02

- leverage as an intel category makes no sense and its effects in the pitch debate are not clear
- the idea of factual intel items that introduce constraints sounds interesting but the effects for the pitch debate are not defined. Do facts prohibit certain actions? and if yes, what happens when we misclassify them?
- the intel taxonomy needs major revision

## Plan 03
- It is correct that antipatterns (and design patterns) should be used to calculate component health, but they should also be used to schedule challenges

## Plan 04

## Plan 05
- intel item refinement chains are a good concept. Refinement chains should also be visually displayed in the intel dossier. Intel items that refine another should visually appear as one larger intel item in the dossier. 

## Plan 06
- an action card should only be composed of intel items and not of corporate noise
- the convincer profiles should be matched at all stakeolders and not just the two most powerful ones
- i am unsure about the "making promieses" idea to counter an objection - i believe it has no learing value and only adds unecessary complexity to the gamplay
- similarly for the "cite evidence" objection response - why would a stakeholder not know the current state of the project environment?
- Compromises/ trades shouldn't be automated away via dialogue options; the players should have to create them themselves by selecting intel items. 
- the patience and stalemate mechanisms are a good solution. 
