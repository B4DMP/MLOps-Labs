"""MLOps environment graph service.

Pure modules: apply, effective, predicates, stage_graph, story. Only `store` touches the
database; import it explicitly so the pure parts stay importable without one.
"""
