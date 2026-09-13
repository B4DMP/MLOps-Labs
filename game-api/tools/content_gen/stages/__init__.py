from content_gen.stages.artifacts import ArtifactsStage
from content_gen.stages.fragments import FragmentsStage
from content_gen.stages.gists import GistsStage
from content_gen.stages.items import ItemsStage
from content_gen.stages.objections import ObjectionsStage
from content_gen.stages.templates import TemplatesStage

STAGES = {s.name: s for s in (
    TemplatesStage(), ItemsStage(), GistsStage(), ArtifactsStage(), ObjectionsStage(), FragmentsStage(),
)}
# Gists depends only on items (D52): it sits right after items so a rerun never marks artifacts,
# objections or fragments stale, and its own stage is independent of them.
ORDER = ["templates", "items", "gists", "artifacts", "objections", "fragments"]
