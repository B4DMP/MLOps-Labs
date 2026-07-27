import json
from pathlib import Path
from philoagents.domain.exceptions import (
    MetricNameNotFound,
    MetricDescriptionNotFound,
    MetricStakeholderNotFound,
    MetricPhasesNotFound
)
from philoagents.domain.metric import Metric

class MetricFactory:
    metrics=[]


    @classmethod
    def load_metrics(cls, metric_config: Path) -> None:
        from philoagents.domain.stakeholder_factory import StakeholderFactory
        with metric_config.open("r", encoding="utf-8") as f:
            data = json.load(f)

        cls.metrics.clear()

        for j in data["metrics"]:
            st = Metric(
                name=j["metric_name"],
                start_value=j["metric_value"],
                phases=j["active"],
                description=j["metric_desc"],
                metric_icon=j["metric_icon"],
                max_value=j["max_value"],
                metric_color=j["metric_color"],
                metric_prompt=j["metric_prompt"]
            )
            cls.metrics.append(st)

    @classmethod
    def get_metric(cls,id: str) -> Metric:
        """Creates a metric instance based on the provided ID.

        Args:
            id (str): Identifier of the metric to create

        Returns:
            Metric: Instance of the metric

        Raises:
            ValueError: If metric ID is not found in configurations
        """
        if id not in cls.get_available_metrics():
            raise MetricNameNotFound(id)

        for metric in cls.metrics:
            if(metric.name==id):
                return metric

    @classmethod
    def get_available_metrics(cls) -> list[str]:
        """Returns a list of all available metric IDs.

        Returns:
            list[str]: List of metric IDs that can be instantiated
        """
        ret=[]
        for metric in cls.metrics:
            ret.append(metric.name)
        
        return ret
    
