import datetime
from typing import Any
from sqlalchemy import delete, func, select, or_, text

from mlops_serious_game.config import settings
from mlops_serious_game.domain.phase_factory import PhaseFactory
from mlops_serious_game.domain.question_factory import QuestionFactory
from mlops_serious_game.domain.metric_factory import MetricFactory
from mlops_serious_game.infrastructure.database import (
    Campaign,
    GameProgression,
    GameChallenge,
    User,
    get_session,
    get_user_id,
)
from mlops_serious_game.infrastructure.database.run_scope import FIRST_RUN

# Checkpoint tables are managed internally by LangGraph, not by our ORM models, and are keyed
# by thread_id rather than username - these are the thread naming conventions used across the
# app (chat_handler, online_intel_service) for a given player.
CHECKPOINT_TABLES = ("checkpoints", "checkpoint_writes", "checkpoint_blobs")


def _player_thread_ids(user_id: int) -> list[str]:
    """Keyed by user_id, not username - see D-user-id in
    docs/plans/session-persistence-and-url-routing.md. Doesn't cover the per-challenge
    Action_Card_Pitch_*/Action_Card_Veto_* threads (variable-length suffix, pre-existing gap not
    introduced by this plan)."""
    return [f"MLOps_Convo_{user_id}", f"Online_Intel_{user_id}"]


def _delete_checkpoints_for_threads(session, thread_ids: list[str]) -> None:
    for table in CHECKPOINT_TABLES:
        if session.execute(text(f"SELECT to_regclass('{table}')")).scalar() is None:
            continue
        for thread_id in thread_ids:
            session.execute(
                text(f"DELETE FROM {table} WHERE thread_id = :thread_id"),
                {"thread_id": thread_id},
            )


def _delete_all_checkpoints(session) -> None:
    for table in CHECKPOINT_TABLES:
        if session.execute(text(f"SELECT to_regclass('{table}')")).scalar() is None:
            continue
        session.execute(text(f"DELETE FROM {table}"))


def get_campaign_users(campaign_key: str) -> list[str]:
    try:
        with get_session() as session:
            users = session.scalars(select(User.user_name).where(User.campaign_key == campaign_key)).all()
            return list(users)
    except Exception:
        return []


def get_campaigns_data() -> list[dict[str, Any]]:
    try:
        with get_session() as session:
            campaigns_list = session.scalars(select(Campaign)).all()
            return [
                {
                    "name": c.campaign_name,
                    "key": c.campaign_key,
                    "is_active": c.is_active,
                    "use_questionnaire": c.use_questionnaire,
                    "allow_replay": c.allow_replay,
                    "is_test_campaign": c.is_test_campaign,
                    "is_bot_campaign": c.is_bot_campaign,
                    "require_email_verification": c.require_email_verification,
                    "intro_phase_enabled": c.intro_phase_enabled,
                    "users": get_campaign_users(c.campaign_key),
                }
                for c in campaigns_list
            ]
    except Exception:
        return []


def get_player_data() -> dict[str, Any]:
    try:
        player_data: dict[str, Any] = {}
        with get_session() as session:
            # 1. Populate all registered users first
            users = session.scalars(select(User)).all()
            campaign_by_key = {c.campaign_key: c for c in session.scalars(select(Campaign)).all()}
            for user in users:
                campaign = campaign_by_key.get(user.campaign_key)
                player_data[user.user_name] = {
                    "maxProgressIndex": 0,
                    "furthestProgression": (0, 0),
                    "lastPlayed": None,
                    "firstPlayed": None,
                    "campaign_name": campaign.campaign_name if campaign else "Not Found",
                    "campaign_key": user.campaign_key,
                    # Defaults to True (score shown) when the campaign itself can't be resolved -
                    # matches the pre-existing admin table, which never hid these columns.
                    "use_questionnaire": campaign.use_questionnaire if campaign else True,
                    "email": user.email,
                    "playtest_tainted": bool(user.playtest_tainted),
                    "runs": 1,
                }

            # 2. Add progression records
            # The first run only: a replay must not move a player's recorded progress, or someone
            # mid-way through their second game would show as "Completed" and a completed one as
            # in progress. The Results page covers runs explicitly.
            progressions = session.scalars(
                select(GameProgression).where(GameProgression.run_index == FIRST_RUN)
            ).all()
            run_counts = dict(
                session.execute(
                    select(GameProgression.user_name, func.max(GameProgression.run_index)).group_by(
                        GameProgression.user_name
                    )
                ).all()
            )
            for prog in progressions:
                player = prog.user_name
                g_idx = prog.game_progress_index
                ts = prog.time_stamp
                if player not in player_data:
                    player_data[player] = {
                        "maxProgressIndex": g_idx,
                        "furthestProgression": (0, 0),
                        "lastPlayed": ts,
                        "firstPlayed": ts,
                        "campaign_name": "Not Found",
                        "campaign_key": "",
                    }
                else:
                    player_data[player]["maxProgressIndex"] = max(
                        player_data[player]["maxProgressIndex"], g_idx
                    )
                    if ts and (not player_data[player]["lastPlayed"] or ts > player_data[player]["lastPlayed"]):
                        player_data[player]["lastPlayed"] = ts
                    if ts and (not player_data[player]["firstPlayed"] or ts < player_data[player]["firstPlayed"]):
                        player_data[player]["firstPlayed"] = ts

            # 3. Add challenge records
            game_sessions = session.scalars(
                select(GameChallenge).where(GameChallenge.run_index == FIRST_RUN)
            ).all()
            for gs in game_sessions:
                player = gs.user_name
                p_idx = gs.phase_index
                c_idx = gs.challenge_index
                ts = gs.time_stamp
                if player not in player_data:
                    player_data[player] = {
                        "maxProgressIndex": 2,
                        "furthestProgression": (p_idx, c_idx),
                        "lastPlayed": ts,
                        "firstPlayed": ts,
                        "campaign_name": "Not Found",
                        "campaign_key": "",
                    }
                else:
                    if (p_idx, c_idx) > player_data[player]["furthestProgression"]:
                        player_data[player]["furthestProgression"] = (p_idx, c_idx)
                    if ts and (
                        not player_data[player]["lastPlayed"]
                        or ts > player_data[player]["lastPlayed"]
                    ):
                        player_data[player]["lastPlayed"] = ts

            for name, highest in run_counts.items():
                if name in player_data:
                    player_data[name]["runs"] = int(highest or 1)

        return player_data
    except Exception:
        return {}


def get_valid_players_set(
    session=None, campaign_key: str | None = None, include_playtest: bool = False
) -> set[str]:
    """Every player whose data counts toward the campaign aggregates.

    The single chokepoint behind every one of them, which is why the playtest exclusion (D10) is
    one clause here rather than a filter added to each. An account that used a playtest tool is
    left out by default, whole: contamination does not stay inside the challenge that caused it.
    """
    valid_players = set()
    try:
        def _fetch(s):
            stmt = select(User.user_name)
            if not include_playtest:
                stmt = stmt.where(User.playtest_tainted.is_(False))
            if campaign_key and campaign_key != "all":
                stmt = stmt.where(User.campaign_key == campaign_key)
            users = s.scalars(stmt).all()
            return set(u for u in users if u)

        if session:
            return _fetch(session)
        with get_session() as session_inst:
            return _fetch(session_inst)
    except Exception:
        pass
    return valid_players


def get_finished_players_set(session=None, campaign_key: str | None = None) -> set[str]:
    finished = set()
    try:
        def _fetch(s):
            valid = get_valid_players_set(s, campaign_key=campaign_key)
            users = s.scalars(
                select(GameProgression.user_name).where(
                    GameProgression.game_progress_index == 4,
                    GameProgression.run_index == FIRST_RUN,
                )
            ).all()
            return set(u for u in users if u and u in valid)

        if session:
            return _fetch(session)
        with get_session() as session_inst:
            return _fetch(session_inst)
    except Exception:
        pass
    return finished


def calculate_intro_percentage(player_name: str) -> int:
    total_questions_amount = 0
    correct_answers_amount = 0
    try:
        with get_session() as session:
            prog = session.scalar(
                select(GameProgression).where(
                    GameProgression.run_index == FIRST_RUN,
                    GameProgression.user_id == get_user_id(session, player_name),
                    GameProgression.game_progress_index == 1,
                )
            )
            if prog and prog.additional_data:
                additional_data = prog.additional_data
                for i, q in enumerate(QuestionFactory.intro_questions):
                    if q.knowledge_question:
                        total_questions_amount += 1
                        if (
                            i < len(additional_data)
                            and additional_data[i]
                            and isinstance(additional_data[i], dict)
                            and "id" in additional_data[i]
                        ):
                            if additional_data[i]["id"] == 0:
                                correct_answers_amount += 1
            else:
                return 0

        if total_questions_amount == 0:
            return 0
        return round((correct_answers_amount / total_questions_amount) * 100)
    except Exception:
        return 0


def calculate_outro_percentage(player_name: str) -> int:
    total_questions_amount = 0
    correct_answers_amount = 0
    try:
        with get_session() as session:
            prog = session.scalar(
                select(GameProgression).where(
                    GameProgression.run_index == FIRST_RUN,
                    GameProgression.user_id == get_user_id(session, player_name),
                    GameProgression.game_progress_index == 4,
                )
            )
            if prog and prog.additional_data:
                additional_data = prog.additional_data
                for i, q in enumerate(QuestionFactory.outro_questions):
                    if q.knowledge_question:
                        total_questions_amount += 1
                        if (
                            i < len(additional_data)
                            and additional_data[i]
                            and isinstance(additional_data[i], dict)
                            and "id" in additional_data[i]
                        ):
                            if additional_data[i]["id"] == 0:
                                correct_answers_amount += 1
            else:
                return 0

        if total_questions_amount == 0:
            return 0
        return round((correct_answers_amount / total_questions_amount) * 100)
    except Exception:
        return 0


def calculate_intro_questionaire_average(campaign_key: str | None = None) -> int:
    try:
        with get_session() as session:
            valid_players = get_valid_players_set(session, campaign_key=campaign_key)
            finished_players = get_finished_players_set(session, campaign_key=campaign_key)
            sum_score = 0
            player_amount = 0
            intro_progs = session.scalars(
                select(GameProgression).where(
                    GameProgression.game_progress_index == 1,
                    GameProgression.run_index == FIRST_RUN,
                )
            ).all()
            for prog in intro_progs:
                user = prog.user_name
                if user not in valid_players or user not in finished_players:
                    continue
                player_score = calculate_intro_percentage(user)
                sum_score += player_score
                player_amount += 1
            if player_amount == 0:
                return 0
            return round(sum_score / player_amount)
    except Exception:
        return 0


def calculate_outro_questionaire_average(campaign_key: str | None = None) -> int:
    try:
        with get_session() as session:
            valid_players = get_valid_players_set(session, campaign_key=campaign_key)
            sum_score = 0
            player_amount = 0
            outro_progs = session.scalars(
                select(GameProgression).where(
                    GameProgression.game_progress_index == 4,
                    GameProgression.run_index == FIRST_RUN,
                )
            ).all()
            for prog in outro_progs:
                user = prog.user_name
                if user not in valid_players:
                    continue
                player_score = calculate_outro_percentage(user)
                sum_score += player_score
                player_amount += 1
            if player_amount == 0:
                return 0
            return round(sum_score / player_amount)
    except Exception:
        return 0


def calculate_total_players(campaign_key: str | None = None) -> int:
    try:
        with get_session() as session:
            return len(get_valid_players_set(session, campaign_key=campaign_key))
    except Exception:
        return 0


def calculate_finished_players(campaign_key: str | None = None) -> int:
    try:
        with get_session() as session:
            return len(get_finished_players_set(session, campaign_key=campaign_key))
    except Exception:
        return 0


def calculate_metric_sum_per_challenge(campaign_key: str | None = None) -> list[float]:
    try:
        total_expected_challenges = 0
        try:
            total_expected_challenges = sum(
                phase.challenge_quota for phase in PhaseFactory.phases if phase.id != 0
            )
        except Exception:
            pass
        if total_expected_challenges <= 0:
            total_expected_challenges = 5

        with get_session() as session:
            valid_players = get_valid_players_set(session, campaign_key=campaign_key)
            if not valid_players:
                return [0.0] * total_expected_challenges

            valid_user_ids = session.scalars(
                select(User.id).where(User.user_name.in_(valid_players))
            ).all()

            if not valid_user_ids:
                return [0.0] * total_expected_challenges

            # Fetch all gameplay challenge records (excluding intro phase 0)
            sessions = session.scalars(
                select(GameChallenge)
                .where(
                    GameChallenge.phase_index != 0,
                    GameChallenge.run_index == FIRST_RUN,
                    GameChallenge.user_id.in_(valid_user_ids),
                )
                .order_by(GameChallenge.id.asc())
            ).all()

            # Group records by player
            player_records: dict[int, list[GameChallenge]] = {}
            for gs in sessions:
                player_records.setdefault(gs.user_id, []).append(gs)

            # For each player, determine their sequence of played challenges
            player_challenge_sums: list[list[float]] = []
            for user_id, records in player_records.items():
                challenges_by_key: dict[tuple[int, int], dict[str, Any]] = {}
                for gs in records:
                    ch_key = (gs.phase_index, gs.challenge_index)
                    if ch_key not in challenges_by_key:
                        challenges_by_key[ch_key] = {
                            "first_id": gs.id,
                            "records": [gs],
                        }
                    else:
                        challenges_by_key[ch_key]["records"].append(gs)

                user_played = []
                for ch_key, ch_data in challenges_by_key.items():
                    valid_rows = [
                        r
                        for r in ch_data["records"]
                        if r.metric_values
                        and isinstance(r.metric_values, list)
                        and len(r.metric_values) >= 6
                    ]
                    if not valid_rows:
                        continue
                    latest_row = max(valid_rows, key=lambda r: r.id)
                    metric_sum = sum(float(v) for v in latest_row.metric_values[:6])
                    user_played.append({
                        "first_id": ch_data["first_id"],
                        "metric_sum": metric_sum,
                    })

                # Sort played challenges chronologically by first encounter
                user_played.sort(key=lambda c: c["first_id"])
                if user_played:
                    player_challenge_sums.append([c["metric_sum"] for c in user_played])

            max_played = max((len(p) for p in player_challenge_sums), default=0)
            num_challenges = max(total_expected_challenges, max_played)

            sum_per_challenge = []
            for i in range(num_challenges):
                total_metrics = 0.0
                players_amount = 0
                for p_sums in player_challenge_sums:
                    if i < len(p_sums):
                        total_metrics += p_sums[i]
                        players_amount += 1

                if players_amount > 0:
                    sum_per_challenge.append(round(total_metrics / players_amount, 2))
                else:
                    sum_per_challenge.append(0.0)

        return sum_per_challenge
    except Exception as e:
        print(f"Error in calculate_metric_sum_per_challenge: {e}")
        return []


def calculate_metric_sum_per_challenge_increase(metric_sum: list[float]) -> list[float]:
    if not metric_sum:
        return []
    baseline = 60.0
    try:
        metrics_available = MetricFactory.get_available_metrics()[:6]
        if metrics_available:
            baseline = float(sum(MetricFactory.get_metric(m).start_value for m in metrics_available))
    except Exception:
        baseline = 60.0

    ret = []
    for i in range(len(metric_sum)):
        if i == 0:
            if metric_sum[0] > 0:
                ret.append(round(metric_sum[0] - baseline, 2))
            else:
                ret.append(0.0)
        else:
            if metric_sum[i] > 0 and metric_sum[i - 1] > 0:
                ret.append(round(metric_sum[i] - metric_sum[i - 1], 2))
            else:
                ret.append(0.0)
    return ret


def get_questionaire_results(campaign_key: str | None = None) -> dict[str, Any]:
    ret: dict[str, Any] = {"intro": [], "outro": []}
    try:
        with get_session() as session:
            valid_players = get_valid_players_set(session, campaign_key=campaign_key)
            finished_players = get_finished_players_set(session, campaign_key=campaign_key)
            expert_players = set()

            intro_progs = session.scalars(
                select(GameProgression).where(
                    GameProgression.game_progress_index == 1,
                    GameProgression.run_index == FIRST_RUN,
                )
            ).all()
            for prog in intro_progs:
                user = prog.user_name
                if user not in valid_players or user not in finished_players:
                    continue
                additional_data = prog.additional_data or []
                if len(additional_data) > 0 and additional_data[0]:
                    ans_id = additional_data[0].get("id", 0)
                    if ans_id in (1, 2, 5):
                        expert_players.add(user)

            outro_progs = session.scalars(
                select(GameProgression).where(
                    GameProgression.game_progress_index == 4,
                    GameProgression.run_index == FIRST_RUN,
                )
            ).all()

            for i, q in enumerate(QuestionFactory.intro_questions):
                answer_dict = [
                    {"answer_name": ans["text"], "amount": 0, "amount_experts": 0, "notes": []}
                    for ans in q.answers
                ]
                if not answer_dict:
                    answer_dict = [
                        {"answer_name": "Written Feedback", "amount": 0, "amount_experts": 0, "notes": []}
                    ]
                for prog in intro_progs:
                    user = prog.user_name
                    if user not in valid_players or user not in finished_players:
                        continue
                    additional_data = prog.additional_data or []
                    if i < len(additional_data) and additional_data[i]:
                        ans_id = additional_data[i].get("id", 0)
                        if 0 <= ans_id < len(answer_dict):
                            note_text = additional_data[i].get("notes")
                            has_note = note_text and str(note_text).strip()
                            if q.answers or has_note:
                                answer_dict[ans_id]["amount"] += 1
                                if user in expert_players:
                                    answer_dict[ans_id]["amount_experts"] += 1
                            if (q.notes or q.inputField) and has_note:
                                answer_dict[ans_id]["notes"].append(note_text)
                ret["intro"].append({"question": q.question, "answers": answer_dict})

            for i, q in enumerate(QuestionFactory.outro_questions):
                answer_dict = [
                    {"answer_name": ans["text"], "amount": 0, "amount_experts": 0, "notes": []}
                    for ans in q.answers
                ]
                if not answer_dict:
                    answer_dict = [
                        {"answer_name": "Written Feedback", "amount": 0, "amount_experts": 0, "notes": []}
                    ]
                for prog in outro_progs:
                    user = prog.user_name
                    if user not in valid_players or user not in finished_players:
                        continue
                    additional_data = prog.additional_data or []
                    if i < len(additional_data) and additional_data[i]:
                        ans_id = additional_data[i].get("id", 0)
                        if 0 <= ans_id < len(answer_dict):
                            note_text = additional_data[i].get("notes")
                            has_note = note_text and str(note_text).strip()
                            if q.answers or has_note:
                                answer_dict[ans_id]["amount"] += 1
                                if user in expert_players:
                                    answer_dict[ans_id]["amount_experts"] += 1
                            if (q.notes or q.inputField) and has_note:
                                answer_dict[ans_id]["notes"].append(note_text)
                ret["outro"].append({"question": q.question, "answers": answer_dict})

            return ret
    except Exception as e:
        print(f"Error processing questionaire results: {e}")
        return {"intro": [], "outro": []}


def _build_player_row(name: str, data: dict[str, Any]) -> dict[str, Any]:
    """Shared by get_admin_dashboard_data and get_teacher_dashboard_data - same row shape for
    both, the only difference is which players each one includes."""
    max_idx = data.get("maxProgressIndex", 0)
    furthest = data.get("furthestProgression", (0, 0))
    phase_index = furthest[0]
    # furthest[1] is the challenge's config id (e.g. 113), not a friendly position - translate it
    # to its 0-based number within the phase, which is what a teacher/admin should see.
    challenge_number = PhaseFactory.get_challenge_number(furthest[0], furthest[1]) if max_idx == 2 else 0
    if max_idx == 0:
        progression_string = "Intro Questionnaire"
    elif max_idx == 1:
        progression_string = "Briefing"
    elif max_idx == 2:
        progression_string = f"Phase {phase_index}, Challenge {challenge_number}"
    elif max_idx == 3:
        progression_string = "Outro Questionnaire"
    else:
        progression_string = "Completed"

    play_time_str = "0d 0h 0m"
    play_time_minutes = 0
    if data.get("lastPlayed") and data.get("firstPlayed"):
        td = data["lastPlayed"] - data["firstPlayed"]
        days = td.days
        hours = td.seconds // 3600
        minutes = (td.seconds % 3600) // 60
        play_time_str = f"{days}d {hours}h {minutes}m"
        play_time_minutes = td.days * 24 * 60 + td.seconds // 60

    return {
        "name": name,
        "email": data.get("email", ""),
        "gameProgression": progression_string,
        "progressIndex": max_idx,
        # Tiebreakers for ranking players within the same progressIndex bucket (e.g. two players
        # both "in progress") - not shown directly, but what "farthest along" actually means.
        "phaseIndex": phase_index,
        "challengeNumber": challenge_number,
        "introPercentage": calculate_intro_percentage(name),
        "outroPercentage": calculate_outro_percentage(name),
        "useQuestionnaire": bool(data.get("use_questionnaire", True)),
        "playTime": play_time_str,
        "playTimeMinutes": play_time_minutes,
        "campaign_name": data.get("campaign_name", "Not Found"),
        "campaign_key": data.get("campaign_key", ""),
        "runs": data.get("runs", 1),
        "playtestTainted": bool(data.get("playtest_tainted", False)),
        "lastActive": data["lastPlayed"].isoformat() if data.get("lastPlayed") else None,
    }


def get_admin_dashboard_data(campaign: str | None = None) -> dict[str, Any]:
    target_campaign_key: str | None = None
    if campaign and campaign != "all":
        with get_session() as session:
            camp = session.scalar(
                select(Campaign).where(
                    or_(Campaign.campaign_key == campaign, Campaign.campaign_name == campaign)
                )
            )
            if camp:
                target_campaign_key = camp.campaign_key
            else:
                target_campaign_key = campaign

    _playerdata = get_player_data()
    playerdata = [_build_player_row(_name, _data) for _name, _data in _playerdata.items()]

    metric_sums = calculate_metric_sum_per_challenge(campaign_key=target_campaign_key)
    return {
        "players": playerdata,
        "campaigns": get_campaigns_data(),
        "total_player_amount": calculate_total_players(campaign_key=target_campaign_key),
        "finished_player_amount": calculate_finished_players(campaign_key=target_campaign_key),
        "metric_sum_per_challenge": metric_sums,
        "metric_sum_per_challenge_increase": calculate_metric_sum_per_challenge_increase(metric_sums),
        "intro_questionaire_average": calculate_intro_questionaire_average(campaign_key=target_campaign_key),
        "outro_questionaire_average": calculate_outro_questionaire_average(campaign_key=target_campaign_key),
        "questionaire_results": get_questionaire_results(campaign_key=target_campaign_key),
        "selected_campaign": target_campaign_key,
    }


def get_teacher_dashboard_data(campaign_keys: list[str]) -> dict[str, Any]:
    """Same player-row shape as get_admin_dashboard_data, but strictly scoped to the given
    campaign keys - the only two callers (teacher_routes' own dashboard, and the admin panel's
    "open teacher view" preview) are both responsible for computing that list correctly; a
    teacher must never see a player outside it."""
    key_set = set(campaign_keys)
    if not key_set:
        return {
            "players": [],
            "campaigns": [],
            "total_player_amount": 0,
            "finished_player_amount": 0,
        }

    _playerdata = get_player_data()
    playerdata = [
        _build_player_row(_name, _data)
        for _name, _data in _playerdata.items()
        if _data.get("campaign_key") in key_set
    ]

    return {
        "players": playerdata,
        "campaigns": [c for c in get_campaigns_data() if c["key"] in key_set],
        "total_player_amount": sum(calculate_total_players(campaign_key=k) for k in key_set),
        "finished_player_amount": sum(calculate_finished_players(campaign_key=k) for k in key_set),
    }


def add_campaign(
    new_campaign_name: str,
    new_campaign_key: str,
    is_active: bool = True,
    use_questionnaire: bool = True,
    allow_replay: bool = False,
    is_test_campaign: bool = False,
    is_bot_campaign: bool = False,
    require_email_verification: bool = True,
    intro_phase_enabled: bool = False,
) -> None:
    try:
        with get_session() as session:
            new_c = Campaign(
                campaign_name=new_campaign_name,
                campaign_key=new_campaign_key,
                is_active=is_active,
                use_questionnaire=use_questionnaire,
                allow_replay=allow_replay,
                is_test_campaign=is_test_campaign,
                is_bot_campaign=is_bot_campaign,
                require_email_verification=require_email_verification,
                intro_phase_enabled=intro_phase_enabled,
            )
            session.add(new_c)
    except Exception as e:
        print(f"Error adding campaign: {e}")
        raise


def update_campaign(
    campaign_key: str,
    is_active: bool | None = None,
    use_questionnaire: bool | None = None,
    campaign_name: str | None = None,
    allow_replay: bool | None = None,
    is_test_campaign: bool | None = None,
    is_bot_campaign: bool | None = None,
    require_email_verification: bool | None = None,
    intro_phase_enabled: bool | None = None,
) -> None:
    try:
        with get_session() as session:
            campaign = session.scalar(select(Campaign).where(Campaign.campaign_key == campaign_key))
            if campaign:
                if is_active is not None:
                    campaign.is_active = is_active
                if use_questionnaire is not None:
                    campaign.use_questionnaire = use_questionnaire
                if campaign_name is not None:
                    campaign.campaign_name = campaign_name
                if allow_replay is not None:
                    campaign.allow_replay = allow_replay
                if is_test_campaign is not None:
                    campaign.is_test_campaign = is_test_campaign
                if is_bot_campaign is not None:
                    campaign.is_bot_campaign = is_bot_campaign
                if require_email_verification is not None:
                    campaign.require_email_verification = require_email_verification
                if intro_phase_enabled is not None:
                    campaign.intro_phase_enabled = intro_phase_enabled
    except Exception as e:
        print(f"Error updating campaign {campaign_key}: {e}")
        raise


def _cleanup_and_delete_user(session, user: User) -> None:
    """Deletes a user and every per-player row that belongs to them.

    Deleting `user` cascades to every table with a `user_id` FK (`ON DELETE CASCADE`, enforced by
    the pk-migration.md constraints) - GameProgression, GameChallenge, GameSession, IntelItem,
    GraphOpLog, GameEventRow all go with it. Only the LangGraph checkpoint tables (not
    ORM-mapped, keyed by thread_id rather than a FK) still need explicit cleanup here.
    """
    _delete_checkpoints_for_threads(session, _player_thread_ids(user.id))
    session.delete(user)
    session.flush()


def remove_campaign(campaign_key: str) -> None:
    """Removes a campaign and all associated players and player data across all tables."""
    try:
        with get_session() as session:
            users = session.scalars(select(User).where(User.campaign_key == campaign_key)).all()
            for user in users:
                _cleanup_and_delete_user(session, user)
            session.execute(delete(Campaign).where(Campaign.campaign_key == campaign_key))
    except Exception as e:
        print(f"Error removing campaign {campaign_key}: {e}")
        raise


def remove_all_campaigns() -> None:
    """Removes every campaign and all associated players and player data across all tables."""
    try:
        remove_all_players()
        with get_session() as session:
            session.execute(delete(Campaign))
    except Exception as e:
        print(f"Error removing all campaigns: {e}")
        raise


def remove_player(player_name: str) -> None:
    """Removes all player-related data of the selected player across all tables.

    Reusing a username after deletion must behave like a genuinely new player: leaving
    GraphOpLog, GameEventRow or checkpoint rows behind lets the old graph state/history bleed
    into the "new" account (e.g. the scheduler replaying stale ops when picking their first
    challenge), so every per-player table needs to be covered here, not just the obvious ones -
    see `_cleanup_and_delete_user`.
    """
    try:
        with get_session() as session:
            user = session.scalar(select(User).where(User.user_name == player_name))
            if user is not None:
                _cleanup_and_delete_user(session, user)
    except Exception as e:
        print(f"Error removing player {player_name}: {e}")
        raise


def reset_player(player_name: str) -> None:
    """Wipes a player's own progress and returns them to a freshly registered account.

    Same per-table cleanup as `remove_player`, but re-inserts a `User` row with the same
    `user_name`, `campaign_key` and `campaign_id` so the player stays in their campaign instead
    of being removed outright. `user_settings` goes with the cascade too, so the recreated
    account starts on defaults - see docs/plans/player-settings-and-tts.md.
    """
    with get_session() as session:
        user = session.scalar(select(User).where(User.user_name == player_name))
        if user is None:
            return
        campaign_key = user.campaign_key
        campaign_id = user.campaign_id
        email = user.email
        password_hash = user.password_hash
        users_on_machine = user.users_on_machine
        is_verified = user.is_verified
        _cleanup_and_delete_user(session, user)
        session.add(User(
            user_name=player_name,
            campaign_key=campaign_key,
            campaign_id=campaign_id,
            email=email,
            password_hash=password_hash,
            users_on_machine=users_on_machine,
            is_verified=is_verified,
        ))


def remove_all_players() -> None:
    """Removes all player-related data across all tables. Deleting every `User` row cascades
    (ON DELETE CASCADE) to every table with a `user_id` FK; only the checkpoint tables (not
    ORM-mapped, keyed by thread_id) still need explicit cleanup - see `_cleanup_and_delete_user`.
    """
    try:
        with get_session() as session:
            session.execute(delete(User))
            _delete_all_checkpoints(session)
    except Exception as e:
        print(f"Error removing all players: {e}")
        raise



def get_game_config_dir():
    from pathlib import Path
    base_dir = Path(__file__).parent
    return (base_dir / "../../../../../gameConfig").resolve()


def list_config_files() -> list[dict[str, Any]]:
    config_dir = get_game_config_dir()
    if not config_dir.exists():
        return []
    
    files = []
    for file_path in sorted(config_dir.glob("*.json")):
        files.append({
            "filename": file_path.name,
            "size": file_path.stat().st_size,
            "modified": datetime.datetime.fromtimestamp(file_path.stat().st_mtime).isoformat()
        })
    return files


def get_game_config_schemas_dir():
    from pathlib import Path
    base_dir = Path(__file__).parent
    return (base_dir / "../../../../../gameConfigSchemas").resolve()


def get_game_config_uischemas_dir():
    from pathlib import Path
    base_dir = Path(__file__).parent
    return (base_dir / "../../../../../gameConfigUISchemas").resolve()


def load_json_schema(filename: str) -> dict[str, Any]:
    from pathlib import Path
    import json
    
    safe_name = Path(filename).name
    schema_filename = safe_name.replace(".json", ".schema.json")
    schema_path = get_game_config_schemas_dir() / schema_filename
    
    if not schema_path.exists():
        return {}
    
    try:
        with schema_path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


async def trigger_generate_offline_intel_artifacts() -> dict[str, Any]:
    from mlops_serious_game.application.intel_handler import generate_and_save_all_offline_intel_artifacts
    return await generate_and_save_all_offline_intel_artifacts()


def load_uischema(filename: str) -> dict[str, Any] | None:
    from pathlib import Path
    import json
    
    safe_name = Path(filename).name
    schema_filename = safe_name.replace(".json", ".uischema.json")
    schema_path = get_game_config_uischemas_dir() / schema_filename
    
    if schema_path.exists():
        try:
            with schema_path.open("r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return None


def get_config_file(filename: str) -> dict[str, Any]:
    from pathlib import Path
    import json
    
    safe_name = Path(filename).name
    if not safe_name.endswith(".json"):
        raise ValueError("Invalid configuration file format. Must be a .json file.")
    
    target_path = get_game_config_dir() / safe_name
    if not target_path.exists():
        raise FileNotFoundError(f"Configuration file '{safe_name}' not found.")
    
    with target_path.open("r", encoding="utf-8") as f:
        content = json.load(f)
    
    schema = load_json_schema(safe_name)
    uischema = load_uischema(safe_name)
    return {
        "filename": safe_name,
        "data": content,
        "schema": schema,
        "uischema": uischema
    }





def save_and_reload_config_file(filename: str, new_content: Any) -> None:
    from pathlib import Path
    import json
    from mlops_serious_game.domain.gameConfigLoader import GameConfigLoader
    
    safe_name = Path(filename).name
    if not safe_name.endswith(".json"):
        raise ValueError("Invalid configuration file format. Must be a .json file.")
    
    target_path = get_game_config_dir() / safe_name
    if not target_path.exists():
        raise FileNotFoundError(f"Configuration file '{safe_name}' not found.")
    
    # Read backup
    with target_path.open("r", encoding="utf-8") as f:
        original_content = f.read()
    
    try:
        # Save updated json nicely formatted
        with target_path.open("w", encoding="utf-8") as f:
            json.dump(new_content, f, indent=2, ensure_ascii=False)
        
        # Trigger runtime reload
        GameConfigLoader.initialize()
    except Exception as e:
        # Restore backup if reload or validation fails
        with target_path.open("w", encoding="utf-8") as f:
            f.write(original_content)
        # Try re-initializing original config
        try:
            GameConfigLoader.initialize()
        except Exception:
            pass
        raise ValueError(f"Failed to apply configuration update: {str(e)}")

