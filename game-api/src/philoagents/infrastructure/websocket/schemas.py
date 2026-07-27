from pydantic import BaseModel, Field
from typing import Any


class WSEvent(BaseModel):
    event: str = Field(..., description="Name of the WebSocket event, e.g., 'game:init'")
    payload: dict[str, Any] = Field(default_factory=dict, description="Event payload dictionary")
    #maybe correlation id later

class WSResponse(BaseModel):
    event: str
    payload: dict[str, Any] = Field(default_factory=dict)
