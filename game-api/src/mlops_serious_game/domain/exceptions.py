class StakeholderNameNotFound(Exception):
    """Exception raised when a stakeholder's name is not found."""

    def __init__(self, stakeholder_id: str):
        self.message = f"Stakeholder name for {stakeholder_id} not found."
        super().__init__(self.message)


class StakeholderRoleDescriptionNotFound(Exception):
    """Exception raised when a stakeholder's role description is not found."""

    def __init__(self, stakeholder_id: str):
        self.message = f"Stakeholder role description for {stakeholder_id} not found."
        super().__init__(self.message)


class StakeholderResponsibilitiesNotFound(Exception):
    """Exception raised when stakeholder responsibilities are not found."""

    def __init__(self, stakeholder_id: str):
        self.message = f"Stakeholder responsibilities for {stakeholder_id} not found."
        super().__init__(self.message)


class StakeholderPrioritiesNotFound(Exception):
    """Exception raised when stakeholder priorities are not found."""

    def __init__(self, stakeholder_id: str):
        self.message = f"Stakeholder priorities for {stakeholder_id} not found."
        super().__init__(self.message)


class StakeholderRequirementsNotFound(Exception):
    """Exception raised when stakeholder requirements are not found."""

    def __init__(self, stakeholder_id: str):
        self.message = f"Stakeholder requirements for {stakeholder_id} not found."
        super().__init__(self.message)


class RoutingStakeholderNotFound(Exception):
    """Exception raised when the routing decision does not match any available stakeholder."""

    def __init__(self, decision: str):
        self.message = f"No stakeholder found for routing decision: {decision}"
        super().__init__(self.message)


class MetricNameNotFound(Exception):
    """Exception raised when a metric's name is not found."""

    def __init__(self, metric_id: str):
        self.message = f"Metric name not found for id: {metric_id}"
        super().__init__(self.message)

class QuestionNameNotFound(Exception):
    """Exception raised when a quesiton's name is not found"""

    def __init__(self, question_id: int):
        self.message=f"Question name not found for id {question_id}"
        super().__init__(self.message)

class MetricDescriptionNotFound(Exception):
    """Exception raised when a metric's description is not found."""

    def __init__(self, metric_id: str):
        self.message = f"Metric description not found for id: {metric_id}"
        super().__init__(self.message)


class MetricStakeholderNotFound(Exception):
    """Exception raised when a metric's stakeholder is not found."""

    def __init__(self, metric_id: str):
        self.message = f"Metric stakeholder not found for id: {metric_id}"
        super().__init__(self.message)


class MetricPhasesNotFound(Exception):
    """Exception raised when a metric's phases are not found."""

    def __init__(self, metric_id: str):
        self.message = f"Metric phases not found for id: {metric_id}"
        super().__init__(self.message)

class NoStakeholderRoute(Exception):
    """Exception raised when router fails to route to any stakeholder"""

    def __init__(self):
        self.message="Router error: no route was found"
        super().__init__(self.message)

class ConfigLoaderError(Exception):
    """Exception when the config fails to load"""

    def __init__(self, cause=""):
        self.message = f"Error while loading config: {cause}" 
        super().__init__(self.message)