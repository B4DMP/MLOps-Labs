from pathlib import Path
import json
from typing import Dict, Optional
from pydantic import BaseModel, Field
from mlops_serious_game.domain.requirement import ArtifactType


class ConvincerArchetypeArtifact(BaseModel):
    archetype: str = Field(description="Name of the convincer archetype")
    artifact_type: ArtifactType = Field(default=ArtifactType.SLACK_MESSAGE, description="UI type of artifact")
    convincer_archetype_artifact: str = Field(description="Artifact content template")


class ConvincerArchetypeArtifactFactory:
    artifacts: Dict[str, ConvincerArchetypeArtifact] = {}

    @classmethod
    def load_artifacts(cls, config_path: Path) -> None:
        if not config_path.exists():
            cls.artifacts.clear()
            return

        with config_path.open("r", encoding="utf-8") as f:
            data = json.load(f)

        cls.artifacts.clear()
        for item in data.get("artifacts", []):
            arch_name = item.get("archetype", "")
            art_type_str = item.get("artifact_type", ArtifactType.SLACK_MESSAGE.value)
            try:
                art_type = ArtifactType(art_type_str)
            except ValueError:
                art_type = ArtifactType.SLACK_MESSAGE

            cls.artifacts[arch_name] = ConvincerArchetypeArtifact(
                archetype=arch_name,
                artifact_type=art_type,
                convincer_archetype_artifact=item.get("convincer_archetype_artifact", "")
            )

    @classmethod
    def get_artifact_for_archetype(cls, archetype_name: str) -> Optional[ConvincerArchetypeArtifact]:
        return cls.artifacts.get(archetype_name)
