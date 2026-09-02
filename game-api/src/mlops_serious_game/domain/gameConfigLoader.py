from pathlib import Path
from mlops_serious_game.domain.briefing_factory import BriefingFactory
from mlops_serious_game.domain.exceptions import ConfigLoaderError
from mlops_serious_game.domain.metric_factory import MetricFactory
from mlops_serious_game.domain.phase_factory import PhaseFactory
from mlops_serious_game.domain.question_factory import QuestionFactory
from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory
from mlops_serious_game.domain.requirement_factory import RequirementFactory
from mlops_serious_game.domain.offline_intel_artifact_factory import OfflineIntelArtifactFactory
from mlops_serious_game.domain.engagementCardFactory import EngagementCardFactory
from mlops_serious_game.domain.emotion_factory import EmotionFactory
from mlops_serious_game.domain.convincer_archetype_artifact_factory import ConvincerArchetypeArtifactFactory


class GameConfigLoader:
    @staticmethod
    def initialize():
        print("Initializing Game Config")
        try:
            base_dir = Path(__file__).parent
            stakeholders_path = (base_dir / "../../../../gameConfig/GameStakeholders.json").resolve()
            StakeholderFactory.load_stakeholders(stakeholders_path)
            print(f"loaded stakeholders:{StakeholderFactory.get_available_stakeholders()}")
            metrics_path = (base_dir / "../../../../gameConfig/GameMetrics.json").resolve()
            MetricFactory.load_metrics(metrics_path)
            print(f"loaded metrics:{MetricFactory.get_available_metrics()}")
            phases_path = (base_dir / "../../../../gameConfig/GameProgression.json").resolve()
            PhaseFactory.load_phases(phases_path)
            print(f"loaded phases.")
            requirements_path = (base_dir / "../../../../gameConfig/RequirementObjects.json").resolve()
            RequirementFactory.load_requirements(requirements_path)
            
            # Run validation
            challenges = []
            for p in PhaseFactory.phases:
                challenges.extend(p.challenges)
            RequirementFactory.validate_requirements(challenges)
            print(f"loaded and validated requirements.")
            
            offline_intel_path = (base_dir / "../../../../gameConfig/OfflineIntelArtifacts.json").resolve()
            OfflineIntelArtifactFactory.load_artifacts(offline_intel_path)
            print(f"loaded offline intel artifacts.")

            convincer_artifacts_path = (base_dir / "../../../../gameConfig/ConvincerArchetypeArtifacts.json").resolve()
            if convincer_artifacts_path.exists():
                ConvincerArchetypeArtifactFactory.load_artifacts(convincer_artifacts_path)
                print(f"loaded convincer archetype artifacts.")

            questions_path= (base_dir/ "../../../../gameConfig/EvaluationQuestions.json")
            QuestionFactory.load_questions(questions_path)
            print(f"loaded questions.")
            briefing_path= (base_dir/ "../../../../gameConfig/Briefing.json")
            BriefingFactory.load_briefing(briefing_path)

            cards_path = (base_dir / "../../../../gameConfig/GameEngagementCards.json").resolve()
            if cards_path.exists():
                EngagementCardFactory.load_cards(cards_path)
                print(f"loaded engagement cards.")

            emotion_path = (base_dir / "../../../../gameConfig/EmotionValueConfig.json").resolve()
            if emotion_path.exists():
                EmotionFactory.load_config(emotion_path)
                print(f"loaded emotion configs.")

        except Exception as e:
            raise ConfigLoaderError(e)

    @staticmethod
    def get_available_metrics() -> list[str]:
        """Returns a list of all available metric IDs.

        Returns:
            list[str]: List of metric IDs that can be instantiated
        """
        return []
    


GameConfigLoader.initialize()