import asyncio
import json
import os
from pathlib import Path

import click
from mlops_serious_game.config import settings
from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory
from persona_gym.code.run import main as persona_gym_main
from persona_gym.code.run import save_scores


@click.command()
@click.option("--name", default="stakeholder_evaluation", type=str, help="Name of the evaluation run (used for saving scores).")
@click.option("--stakeholder_id", default=-1, type=int, help="ID of the stakeholder to evaluate. -1 means all stakeholders.")
def main(name: str, stakeholder_id: int) -> None:
    """
    Evaluate the stakeholder agents using persona-gym.
    """
    stakeholder_names=[]
    if stakeholder_id == -1:
        stakeholder_names = StakeholderFactory.get_available_stakeholders()

    elif stakeholder_id >= len(StakeholderFactory.get_available_stakeholders()):
        raise ValueError(f"Stakeholder ID {stakeholder_id} out of range (max: {len(StakeholderFactory.get_available_stakeholders()) - 1})")
    else:
        stakeholder_names = [StakeholderFactory.get_available_stakeholders()[stakeholder_id]]

    _QUESTIONS_BASE = Path(__file__).parent / "persona_gym" / "questions"

    results = {}
    available = StakeholderFactory.get_available_stakeholders()
    for st in stakeholder_names:
        questions_dir = _QUESTIONS_BASE / "stakeholder_eval" / st
        if not questions_dir.exists():
            print(f"Skipping '{st}': no questions folder found at '{questions_dir}'.")
            continue

        print(f"Evaluating persona: {st}")
        scores = asyncio.run(persona_gym_main(
            stakeholder_id=available.index(st),
            eval_name=name,
            saved_questions=f"stakeholder_eval/{st}"
        ))
        results[st] = scores.get("PersonaScore")
        print(f"  -> PersonaScore: {results[st]:.3f}")
        
    print("\nEvaluation complete.")
    print(results)

    save_scores(name, results)


if __name__ == "__main__":
    main()
