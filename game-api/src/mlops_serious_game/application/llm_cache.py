import asyncio
import datetime
import hashlib

from langchain_core.caches import BaseCache
from langchain_core.load import dumps, loads
from langchain_core.messages import AIMessage, AIMessageChunk
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, Generation
from loguru import logger
from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert

from mlops_serious_game.config import settings
from mlops_serious_game.infrastructure.database import get_session
from mlops_serious_game.infrastructure.database.models import LlmCacheEntry, LlmCacheStat

# One cache per chain, so hit rates are reported per chain. Content generation and debug scripts
# are deliberately absent: they want a fresh answer for the same prompt.
CACHE_LABELS: dict[str, str] = {
    "action_card": "Action card generation",
    "pitch_player": "Action card pitch: player line",
    "pitch_stakeholder": "Action card pitch: stakeholder reactions",
    "veto": "Action card veto",
    "online_intel_player": "Online intel: player message",
    "online_intel_stakeholder": "Online intel: stakeholder reply",
    "debate_kickoff": "Pitch debate: player kickoff",
    "debate_player_utterance": "Pitch debate: player utterance",
    "debate_stakeholder_engagement": "Pitch debate: stakeholder engagement reply",
    "debate_stakeholder_response": "Pitch debate: stakeholder response",
}


# What a cached answer can contain; anything else in a row is refused rather than revived.
_ALLOWED = [Generation, ChatGeneration, ChatGenerationChunk, AIMessage, AIMessageChunk]


def _key_hash(prompt: str, llm_string: str) -> str:
    return hashlib.sha256(f"{prompt}\x00{llm_string}".encode()).hexdigest()


class PostgresCache(BaseCache):
    """An LLM cache in Postgres, so answers outlive a restart.

    Rows carry the build version; a different build never sees them (see `purge_stale`). The
    cache is an optimisation, so a database error is logged and treated as a miss."""

    def __init__(self, name: str) -> None:
        self.name = name

    def _count(self, session, hit: bool) -> None:
        stmt = insert(LlmCacheStat).values(
            cache_name=self.name,
            version=settings.BUILD_VERSION,
            hits=int(hit),
            misses=int(not hit),
        )
        session.execute(stmt.on_conflict_do_update(
            index_elements=["cache_name", "version"],
            set_={
                "hits": LlmCacheStat.hits + int(hit),
                "misses": LlmCacheStat.misses + int(not hit),
            },
        ))

    def lookup(self, prompt, llm_string):
        try:
            with get_session() as session:
                row = session.execute(
                    update(LlmCacheEntry)
                    .where(
                        LlmCacheEntry.cache_name == self.name,
                        LlmCacheEntry.version == settings.BUILD_VERSION,
                        LlmCacheEntry.key_hash == _key_hash(prompt, llm_string),
                    )
                    .values(last_used_at=datetime.datetime.utcnow())
                    .returning(LlmCacheEntry.response)
                ).first()
                found = loads(row[0], allowed_objects=_ALLOWED) if row else None
                self._count(session, hit=found is not None)
                return found
        except Exception as exc:
            logger.warning(f"LLM cache lookup failed for {self.name!r}, treating as a miss: {exc}")
            return None

    def update(self, prompt, llm_string, return_val):
        try:
            with get_session() as session:
                key = dict(cache_name=self.name, version=settings.BUILD_VERSION)
                now = datetime.datetime.utcnow()
                session.execute(
                    insert(LlmCacheEntry)
                    .values(**key, key_hash=_key_hash(prompt, llm_string),
                            response=dumps(list(return_val)), created_at=now, last_used_at=now)
                    .on_conflict_do_update(
                        constraint="uq_llm_cache_key",
                        set_={"response": dumps(list(return_val)), "last_used_at": now},
                    )
                )
                # Least recently used first.
                keep = (
                    select(LlmCacheEntry.id)
                    .where(LlmCacheEntry.cache_name == self.name, LlmCacheEntry.version == settings.BUILD_VERSION)
                    .order_by(LlmCacheEntry.last_used_at.desc(), LlmCacheEntry.id.desc())
                    .limit(settings.LLM_CACHE_MAXSIZE)
                )
                session.execute(
                    delete(LlmCacheEntry).where(
                        LlmCacheEntry.cache_name == self.name,
                        LlmCacheEntry.version == settings.BUILD_VERSION,
                        LlmCacheEntry.id.not_in(keep),
                    )
                )
        except Exception as exc:
            logger.warning(f"LLM cache write failed for {self.name!r}: {exc}")

    def clear(self, **kwargs) -> None:
        with get_session() as session:
            session.execute(delete(LlmCacheEntry).where(LlmCacheEntry.cache_name == self.name))

    async def alookup(self, prompt, llm_string):
        return await asyncio.to_thread(self.lookup, prompt, llm_string)

    async def aupdate(self, prompt, llm_string, return_val):
        await asyncio.to_thread(self.update, prompt, llm_string, return_val)

    async def aclear(self, **kwargs) -> None:
        await asyncio.to_thread(self.clear)


_caches: dict[str, PostgresCache] = {}


def get_cache(name: str) -> PostgresCache | None:
    """The cache for a chain, or None when caching is switched off."""
    if name not in CACHE_LABELS:
        raise ValueError(f"unknown LLM cache {name!r}")
    if not settings.LLM_CACHE_ENABLED:
        return None
    if name not in _caches:
        _caches[name] = PostgresCache(name)
    return _caches[name]


def purge_stale() -> int:
    """Drop everything cached under another build version. Returns the entries removed.

    Run at start-up: a new build starts with an empty cache, a plain restart keeps it."""
    with get_session() as session:
        removed = session.execute(
            delete(LlmCacheEntry).where(LlmCacheEntry.version != settings.BUILD_VERSION)
        ).rowcount
        session.execute(delete(LlmCacheStat).where(LlmCacheStat.version != settings.BUILD_VERSION))
    return removed


def cache_stats() -> dict:
    """Entries and hit rate per cache under the current build version."""
    version = settings.BUILD_VERSION
    with get_session() as session:
        entries = dict(session.execute(
            select(LlmCacheEntry.cache_name, func.count())
            .where(LlmCacheEntry.version == version)
            .group_by(LlmCacheEntry.cache_name)
        ).all())
        counts = {
            name: (hits, misses)
            for name, hits, misses in session.execute(
                select(LlmCacheStat.cache_name, LlmCacheStat.hits, LlmCacheStat.misses)
                .where(LlmCacheStat.version == version)
            ).all()
        }

    rows = []
    for name, label in CACHE_LABELS.items():
        hits, misses = counts.get(name, (0, 0))
        requests = hits + misses
        rows.append({
            "name": name,
            "label": label,
            "entries": entries.get(name, 0),
            "hits": hits,
            "misses": misses,
            "hit_rate": hits / requests if requests else None,
        })
    total_hits = sum(r["hits"] for r in rows)
    total_requests = total_hits + sum(r["misses"] for r in rows)
    return {
        "enabled": settings.LLM_CACHE_ENABLED,
        "version": version,
        "maxsize": settings.LLM_CACHE_MAXSIZE,
        "caches": rows,
        "total_entries": sum(r["entries"] for r in rows),
        "total_hits": total_hits,
        "total_requests": total_requests,
        "total_hit_rate": total_hits / total_requests if total_requests else None,
    }
