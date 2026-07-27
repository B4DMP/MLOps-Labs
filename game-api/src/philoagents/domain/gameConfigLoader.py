from pathlib import Path
from philoagents.domain.briefing_factory import BriefingFactory
from philoagents.domain.exceptions import ConfigLoaderError
from philoagents.domain.metric_factory import MetricFactory
from philoagents.domain.phase_factory import PhaseFactory
from philoagents.domain.question_factory import QuestionFactory
from philoagents.domain.stakeholder_factory import StakeholderFactory


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
            questions_path= (base_dir/ "../../../../gameConfig/EvaluationQuestions.json")
            QuestionFactory.load_questions(questions_path)
            print(f"loaded questions.")
            briefing_path= (base_dir/ "../../../../gameConfig/Briefing.json")
            BriefingFactory.load_briefing(briefing_path)
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