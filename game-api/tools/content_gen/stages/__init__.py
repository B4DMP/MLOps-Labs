from content_gen.stages.artifacts import ArtifactsStage
from content_gen.stages.fragments import FragmentsStage
from content_gen.stages.gists import GistsStage
from content_gen.stages.humor import HumorStage
from content_gen.stages.items import ItemsStage
from content_gen.stages.objections import ObjectionsStage
from content_gen.stages.templates import TemplatesStage

STAGES = {s.name: s for s in (
    TemplatesStage(), ItemsStage(), GistsStage(), ArtifactsStage(), ObjectionsStage(), FragmentsStage(), HumorStage(),
)}
# Gists depends only on items (D52): it sits right after items so a rerun never marks artifacts,
# objections or fragments stale, and its own stage is independent of them.
# Humor depends only on artifacts (its plan() reads ctx.approved("artifacts") directly), and only
# processes records select-humor already flagged "selected" - it sits last so it never blocks or
# gets blocked by objections/fragments, which are independent of it.
ORDER = ["templates", "items", "gists", "artifacts", "objections", "fragments", "humor"]
