from pydantic import BaseModel, Field


class Persona(BaseModel):
    """One interchangeable identity a stakeholder can wear for a single player.

    A stakeholder's role, colors and prose are fixed; the persona only swaps the
    name and the parts of the avatar that describe the person rather than the
    role. Names stay alliterative with the role word (Data Dave, Data Dominic)
    and keep the gender of the canonical persona, so the config prose reads
    correctly whichever persona a player draws.
    """

    key: str = Field(description="Stable identifier of this persona within its stakeholder")
    name: str = Field(description="Full display name, e.g. 'Data Dominic'")
    avatar: dict = Field(
        default_factory=dict,
        description=(
            "Open Peeps overrides layered on top of the stakeholder's base avatar. "
            "Holds only person-level traits (head, facial hair, accessories, skin and "
            "hair color); the role-level identity colors stay in the base avatar."
        ),
    )

    @property
    def first_name(self) -> str:
        """The given name, i.e. the last word of the alliterative full name."""
        parts = self.name.split()
        return parts[-1] if parts else self.name
