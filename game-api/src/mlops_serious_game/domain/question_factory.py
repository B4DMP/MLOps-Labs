import json
from pathlib import Path
from mlops_serious_game.domain.exceptions import (
    QuestionNameNotFound
)

from mlops_serious_game.domain.question import Question

class QuestionFactory:
    intro_questions=[]
    outro_questions=[]

    @classmethod
    def load_questions(cls, question_config: Path) -> None:
        with question_config.open("r", encoding="utf-8") as f:
            data = json.load(f)

        cls.intro_questions.clear()
        cls.outro_questions.clear()

        for q in data["intro_questions"]:
            question = Question(
                question=q["question"],
                answers=q["answers"],
                knowledge_question=q["knowledge_question"],
                notes=q["notes"],
                inputField=q["inputField"],
                title=q.get("title"),
                description=q.get("description"),
                taxonomy=q.get("taxonomy")
            )
            cls.intro_questions.append(question)
        
        for q in data["outro_questions"]:
            question = Question(
                question=q["question"],
                answers=q["answers"],
                knowledge_question=q["knowledge_question"],
                notes=q["notes"],
                inputField=q["inputField"],
                title=q.get("title"),
                description=q.get("description"),
                taxonomy=q.get("taxonomy")
            )
            cls.outro_questions.append(question)


    @classmethod
    def get_question(cls,id: str) -> Question:
        """Returns a question instance based on the provided ID.

        Args:
            id (str): Identifier of the question to create

        Returns:
            Question: Instance of the Question

        Raises:
            ValueError: If question ID is not found in configurations
        """
        return cls.questions[id]

    @classmethod
    def get_available_questions(cls) -> list[int]:
        """Returns a list of all available question IDs.

        Returns:
            list[int]: List of quesiton IDs that can be instantiated
        """
        ret=[]
        for i in range( len(cls.questions)):
            ret.append(i)
        
        return ret
