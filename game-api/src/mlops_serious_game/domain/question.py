import json
from pathlib import Path
from pydantic import BaseModel, Field

class Question(BaseModel):
    question: str = Field(description="text that makes up the quesiton")
    answers: list[dict] = Field(description="possible answers to the question")
    knowledge_question: bool = Field(description="whether the question is a knowledge question")
    notes: bool = Field(description="whether the question has notes")
    inputField: bool = Field(default=False, description="whether the question has an input field")
    title: str|None = Field(default=None, description="title of the question")
    description: str|None = Field(default=None, description="description of the question")
    taxonomy: str|None = Field(default=None, description="taxonomy of the question")

    def __str__(self) -> str:
        return f"Question:{self.question}\n" 
    
    @classmethod
    def from_json(cls, metadata_file: Path) -> list["Question"]:
        """Load questions from a JSON configuration file."""
        with open(metadata_file, "r") as f:
            metric_data = json.load(f)

        return [cls(**metric) for metric in metric_data]