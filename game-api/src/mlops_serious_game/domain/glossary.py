from pydantic import BaseModel, Field


class GlossarySurfaces(BaseModel):
    """Which parts of the game highlight glossary terms.

    Every surface can be switched off on its own, because the cost of highlighting is not the
    same everywhere: a sticky note is read at leisure, while a debate speech bubble is on a
    timer and is click-to-skip, so a hover target inside it competes with the interaction.
    """

    stakeholder_messages: bool = Field(default=True, description="Chat messages from stakeholders")
    speech_bubbles: bool = Field(default=False, description="Pitch debate speech bubbles (transient, click-to-skip)")
    intel_notes: bool = Field(default=True, description="Dossier intel sticky notes")
    intel_artifacts: bool = Field(default=True, description="Offline intel artifacts (emails, chats, documents)")
    dossier_profile: bool = Field(default=True, description="Dossier role, responsibilities and priorities text")
    dialogue_options: bool = Field(default=True, description="Pitch debate dialogue cards")
    challenge_briefing: bool = Field(default=True, description="Challenge description and phase briefing")
    action_proposal: bool = Field(
        default=True,
        description="Compose Action Proposal inspector: component names and the explanations of what holds them back",
    )


class GlossarySettings(BaseModel):
    """Matching behaviour for the highlighter."""

    enabled: bool = Field(default=True, description="Master switch for glossary highlighting")
    case_sensitive: bool = Field(default=False, description="Whether matching respects letter case")
    match_whole_words: bool = Field(default=True, description="Whether matches must sit on word boundaries")
    max_highlights_per_term_per_block: int = Field(
        default=1,
        ge=0,
        description="How often one term is highlighted within a single text block (0 for unlimited)",
    )
    min_term_length: int = Field(default=2, ge=1, description="Terms and aliases shorter than this are ignored")
    surfaces: GlossarySurfaces = Field(default_factory=GlossarySurfaces, description="Per-surface toggles")


class GlossaryCategory(BaseModel):
    """A grouping of terms, carrying the accent colour of the highlight."""

    id: str = Field(description="Category identifier referenced by terms")
    label: str = Field(description="Display label shown on the hover card")
    color: str = Field(default="#6366f1", description="Hex accent colour")
    icon: str = Field(default="", description="Iconify icon name")


class GlossaryTerm(BaseModel):
    """One highlighted term and the explanation shown when a player hovers it."""

    id: str = Field(description="Stable unique identifier")
    term: str = Field(description="Canonical spelling, shown as the hover card heading")
    aliases: list[str] = Field(default_factory=list, description="Other spellings that map to this entry")
    category: str = Field(default="lifecycle", description="Category id")
    definition: str = Field(description="Plain language explanation")
    why_it_matters: str = Field(default="", description="Optional tie-in to this game's stakeholders and challenges")
    read_more: str = Field(default="", description="Optional external link")
    disabled: bool = Field(default=False, description="Keep the entry but stop highlighting it")


class GlossaryConfig(BaseModel):
    """Complete glossary configuration matching MLOpsGlossary.json."""

    settings: GlossarySettings = Field(default_factory=GlossarySettings, description="Matching behaviour")
    categories: list[GlossaryCategory] = Field(default_factory=list, description="Term categories")
    terms: list[GlossaryTerm] = Field(default_factory=list, description="Highlighted terms")
