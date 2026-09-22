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
from mlops_serious_game.domain.glossary_factory import GlossaryFactory
from mlops_serious_game.domain.graph_factory import GraphFactory
from mlops_serious_game.domain.epilogue_factory import EpilogueFactory
from mlops_serious_game.domain.story_factory import StoryFactory
from mlops_serious_game.domain.pattern import PatternFactory
from mlops_serious_game.domain.setting_factory import SettingFactory


class GameConfigLoader:
    @staticmethod
    def initialize(config_dir: Path | None = None):
        """Loads every factory from `config_dir`, by default the repo's (or container's) gameConfig."""
        print("Initializing Game Config")
        try:
            config_dir = config_dir or (Path(__file__).parent / "../../../../gameConfig").resolve()
            setting_path = (config_dir / "Setting.json")
            if setting_path.exists():
                SettingFactory.load(setting_path)
                print(f"loaded setting: {SettingFactory.company()} / {SettingFactory.system()}")
            else:
                SettingFactory.clear()
                print("no Setting.json, content and agents run without a named world")
            stakeholders_path = (config_dir / "GameStakeholders.json")
            StakeholderFactory.load_stakeholders(stakeholders_path)
            print(f"loaded stakeholders:{StakeholderFactory.get_available_stakeholders()}")
            metrics_path = (config_dir / "GameMetrics.json")
            MetricFactory.load_metrics(metrics_path)
            print(f"loaded metrics:{MetricFactory.get_available_metrics()}")
            phases_path = (config_dir / "GameProgression.json")
            PhaseFactory.load_phases(phases_path)
            print(f"loaded phases.")
            requirements_path = (config_dir / "RequirementObjects.json")
            RequirementFactory.load_requirements(requirements_path)
            
            # Run validation
            challenges = []
            for p in PhaseFactory.phases:
                challenges.extend(p.challenges)
            RequirementFactory.validate_requirements(challenges)
            print(f"loaded and validated requirements.")
            
            offline_intel_path = (config_dir / "OfflineIntelArtifacts.json")
            OfflineIntelArtifactFactory.load_artifacts(offline_intel_path)
            print(f"loaded offline intel artifacts.")

            graph_path = (config_dir / "MlopsGraph.json")
            graph = GraphFactory.load_graph(graph_path)
            story_path = (config_dir / "MlopsStoryFragments.json")
            StoryFactory.load(story_path, graph)
            patterns_path = (config_dir / "MlopsPatterns.json")
            PatternFactory.load(patterns_path, graph)
            stakeholder_ids = set(StakeholderFactory.get_available_stakeholders())
            PhaseFactory.validate_templates(graph, PatternFactory.ids(), stakeholder_ids)
            MetricFactory.validate_component_weights(graph)
            RequirementFactory.validate_payloads(graph, set(MetricFactory.get_available_metrics()), stakeholder_ids)
            print(f"loaded MLOps graph: {len(graph.components)} components, {len(graph.edges)} edges, {len(PatternFactory.patterns)} patterns.")

            questions_path= (config_dir / "EvaluationQuestions.json")
            QuestionFactory.load_questions(questions_path)
            print(f"loaded questions.")

            epilogue_path = (config_dir / "EndgameEpilogue.json")
            EpilogueFactory.load(epilogue_path)
            print(f"loaded endgame epilogue: {len(EpilogueFactory.verdicts)} bands, {len(EpilogueFactory.beats)} beats.")
            briefing_path= (config_dir / "Briefing.json")
            BriefingFactory.load_briefing(briefing_path)

            cards_path = (config_dir / "GameEngagementCards.json")
            if cards_path.exists():
                EngagementCardFactory.load_cards(cards_path)
                print(f"loaded engagement cards.")

            emotion_path = (config_dir / "EmotionValueConfig.json")
            if emotion_path.exists():
                EmotionFactory.load_config(emotion_path)
                print(f"loaded emotion configs.")

            GlossaryFactory.clear()
            for file_name, kind in (("MLOpsGlossary.json", "mlops"), ("DomainGlossary.json", "domain")):
                glossary_path = (config_dir / file_name)
                if not glossary_path.exists():
                    continue
                # A broken glossary costs highlighting, not a game: never let it block startup.
                try:
                    GlossaryFactory.load_glossary(glossary_path, kind)
                    print(f"loaded {kind} glossary: {len(GlossaryFactory.get_terms(kind))} terms.")
                except Exception as e:
                    print(f"failed to load the {kind} glossary, its highlighting is disabled: {e}")

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