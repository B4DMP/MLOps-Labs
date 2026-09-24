from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from mlops_serious_game.application.services import tts_service, user_settings_service
from mlops_serious_game.application.services.tts_service import VoiceSlot
from mlops_serious_game.config import settings

from .auth_routes import get_current_player

router = APIRouter(prefix="/api/tts", tags=["TTS"])


class TTSRequest(BaseModel):
    text: str
    slot: VoiceSlot
    seed: str | None = None


@router.post("")
async def synthesize_speech(req: TTSRequest, username: str = Depends(get_current_player)):
    """Server-side narration (docs/plans/player-settings-and-tts.md). POST, not GET, because
    intel artifacts can be long and this avoids URL-encoding a whole document.

    Trusts the frontend to have already cleaned the text the way `stripForSpeech` does - it
    already has to run that pass for the `window.speechSynthesis` fallback, so doing it twice
    would just be redundant work on the hot path.
    """
    if not settings.TTS_BACKEND_ENABLED:
        raise HTTPException(status_code=503, detail="Server-side TTS is disabled.")

    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="text must not be empty.")

    # The player's own gender choice and narration speed always come from their stored settings,
    # never from the request body - letting the client pass either here would be a pointless
    # attack surface for zero benefit, since the settings system (not this request) is the single
    # source of truth. One lookup covers both, since speed applies to every slot.
    player_settings = user_settings_service.get_settings(username)
    player_voice_gender = player_settings["player_voice_gender"] if req.slot == "player" else None
    speed = player_settings["speech_rate"]

    return StreamingResponse(
        tts_service.synthesize(text, req.slot, req.seed, player_voice_gender, speed),
        media_type="audio/mpeg",
    )
