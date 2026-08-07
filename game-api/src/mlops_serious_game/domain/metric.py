import json
from pathlib import Path
from pydantic import BaseModel, Field

class Metric(BaseModel):
    id: str = Field(description="Unique identifier for the metric")
    name: str = Field(description="Name of the metric")
    description: str = Field(description="description of the metric")
    start_value: int = Field(description="Starting Value of the Metric")
    phases: list[bool] = Field(description="Game Phases during which the metric is used")
    metric_icon: str= Field(description="metric icon")
    max_value: int= Field(description="maximal value that the metric can have")
    metric_color: str= Field(description="RGB color of the metric")
    metric_prompt: str= Field(description="prompt for the LLM to determine the metric value")
    def __str__(self) -> str:
        return f"Metric ID:{self.id}\nMetric Name:{self.name}\nMetric Description:{self.description}\n" 
    
    @classmethod
    def from_json(cls, metadata_file: Path) -> list["Metric"]:
        """Load metrics from a JSON configuration file."""
        with open(metadata_file, "r") as f:
            metric_data = json.load(f)

        return [cls(**metric) for metric in metric_data]