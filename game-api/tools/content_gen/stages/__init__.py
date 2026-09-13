from content_gen.stages.artifacts import ArtifactsStage
from content_gen.stages.fragments import FragmentsStage
from content_gen.stages.items import ItemsStage
from content_gen.stages.objections import ObjectionsStage
from content_gen.stages.templates import TemplatesStage

STAGES = {s.name: s for s in (TemplatesStage(), ItemsStage(), ArtifactsStage(), ObjectionsStage(), FragmentsStage())}
ORDER = ["templates", "items", "artifacts", "objections", "fragments"]
