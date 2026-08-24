import datetime
from typing import Any
from sqlalchemy import delete, func, select

from mlops_serious_game.config import settings
from mlops_serious_game.domain.phase_factory import PhaseFactory
from mlops_serious_game.domain.question_factory import QuestionFactory
from mlops_serious_game.infrastructure.database import Campaign, GameProgression, GameSession, User, get_session


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
            progressions = session.scalars(select(GameProgression)).all()
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
                    }
                else:
                    player_data[player]["maxProgressIndex"] = max(
                        player_data[player]["maxProgressIndex"], g_idx
                    )
                    if ts and ts > player_data[player]["lastPlayed"]:
                        player_data[player]["lastPlayed"] = ts
                    if ts and ts < player_data[player]["firstPlayed"]:
                        player_data[player]["firstPlayed"] = ts

            game_sessions = session.scalars(select(GameSession)).all()
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
                    }
                else:
                    if (p_idx, c_idx) > player_data[player]["furthestProgression"]:
                        player_data[player]["furthestProgression"] = (p_idx, c_idx)
                    if ts and (
                        not player_data[player]["lastPlayed"]
                        or ts > player_data[player]["lastPlayed"]
                    ):
                        player_data[player]["lastPlayed"] = ts

            users = session.scalars(select(User)).all()
            campaigns = {c.campaign_key: c.campaign_name for c in session.scalars(select(Campaign)).all()}
            for user in users:
                if user.user_name in player_data:
                    player_data[user.user_name]["campaign_name"] = campaigns.get(
                        user.campaign_key, "Not Found"
                    )

        return player_data
    except Exception:
        return {}


def get_valid_players_set(session=None) -> set[str]:
    valid_players = set()
    try:
        if session:
            users = session.scalars(select(User.user_name)).all()
            return set(u for u in users if u)
        with get_session() as session_inst:
            users = session_inst.scalars(select(User.user_name)).all()
            return set(u for u in users if u)
    except Exception:
        pass
    return valid_players


def get_finished_players_set(session=None) -> set[str]:
    finished = set()
    try:
        if session:
            users = session.scalars(
                select(GameProgression.user_name).where(GameProgression.game_progress_index == 4)
            ).all()
            return set(u for u in users if u)
        with get_session() as session_inst:
            users = session_inst.scalars(
                select(GameProgression.user_name).where(GameProgression.game_progress_index == 4)
            ).all()
            return set(u for u in users if u)
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
                    GameProgression.user_name == player_name,
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
                    GameProgression.user_name == player_name,
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


def calculate_intro_questionaire_average() -> int:
    try:
        with get_session() as session:
            valid_players = get_valid_players_set(session)
            finished_players = get_finished_players_set(session)
            sum_score = 0
            player_amount = 0
            intro_progs = session.scalars(
                select(GameProgression).where(GameProgression.game_progress_index == 1)
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


def calculate_outro_questionaire_average() -> int:
    try:
        with get_session() as session:
            valid_players = get_valid_players_set(session)
            sum_score = 0
            player_amount = 0
            outro_progs = session.scalars(
                select(GameProgression).where(GameProgression.game_progress_index == 4)
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


def calculate_total_players() -> int:
    try:
        with get_session() as session:
            amount = session.scalar(
                select(func.count(GameProgression.id)).where(
                    GameProgression.game_progress_index == 1
                )
            )
            return amount or 0
    except Exception:
        return 0


def calculate_finished_players() -> int:
    try:
        with get_session() as session:
            valid_players = get_valid_players_set(session)
            amount = 0
            outro_progs = session.scalars(
                select(GameProgression).where(GameProgression.game_progress_index == 4)
            ).all()
            for prog in outro_progs:
                if prog.user_name in valid_players:
                    amount += 1
            return amount
    except Exception:
        return 0


def calculate_metric_sum_per_challenge() -> list[float]:
    try:
        sum_per_challenge = []
        with get_session() as session:
            valid_players = get_valid_players_set(session)

            for p_id, phase in enumerate(PhaseFactory.phases):
                if p_id == 0:
                    continue
                is_last_phase = p_id == len(PhaseFactory.phases) - 1
                for c_id, challenge in enumerate(phase.challenges):
                    total_metrics = 0.0
                    players_amount = 0
                    is_last_challenge = c_id == len(phase.challenges) - 1
                    if is_last_challenge:
                        if is_last_phase:
                            target_p_id = p_id
                            target_c_id = len(phase.challenges)
                        else:
                            target_p_id = p_id + 1
                            target_c_id = 0
                    else:
                        target_p_id = p_id
                        target_c_id = c_id + 1

                    sessions = session.scalars(
                        select(GameSession).where(GameSession.phase_index == target_p_id)
                    ).all()
                    for gs in sessions:
                        user = gs.user_name
                        if user not in valid_players:
                            continue
                        if gs.challenge_index == target_c_id:
                            metric_values = gs.metric_values
                            if metric_values and len(metric_values) >= 6:
                                total_metrics += sum(metric_values[:6])
                                players_amount += 1

                    if players_amount > 0:
                        sum_per_challenge.append(total_metrics / players_amount)
                    else:
                        sum_per_challenge.append(0.0)

        return sum_per_challenge
    except Exception as e:
        print(f"Error in calculate_metric_sum_per_challenge: {e}")
        return []


def calculate_metric_sum_per_challenge_increase(metric_sum: list[float]) -> list[float]:
    ret = [0.0]
    for i in range(len(metric_sum)):
        if i > 0:
            ret.append(metric_sum[i] - metric_sum[i - 1])
    return ret


def get_questionaire_results() -> dict[str, Any]:
    ret: dict[str, Any] = {"intro": [], "outro": []}
    try:
        with get_session() as session:
            valid_players = get_valid_players_set(session)
            finished_players = get_finished_players_set(session)
            expert_players = set()

            intro_progs = session.scalars(
                select(GameProgression).where(GameProgression.game_progress_index == 1)
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
                select(GameProgression).where(GameProgression.game_progress_index == 4)
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


def get_admin_dashboard_data() -> dict[str, Any]:
    _playerdata = get_player_data()
    playerdata = []
    for _name, _data in _playerdata.items():
        progressionString = ""
        max_idx = _data.get("maxProgressIndex", 0)
        if max_idx == 0:
            progressionString = "Intro Questionnaire"
        elif max_idx == 1:
            progressionString = "Briefing"
        elif max_idx == 2:
            furthest = _data.get("furthestProgression", (0, 0))
            progressionString = f"Phase {furthest[0]}, Challenge {furthest[1]}"
        elif max_idx == 3:
            progressionString = "Outro Questionnaire"
        elif max_idx == 4:
            progressionString = "Completed"

        play_time_str = "0d 0h 0m"
        if _data.get("lastPlayed") and _data.get("firstPlayed"):
            td = _data["lastPlayed"] - _data["firstPlayed"]
            days = td.days
            hours = td.seconds // 3600
            minutes = (td.seconds % 3600) // 60
            play_time_str = f"{days}d {hours}h {minutes}m"

        playerdata.append({
            "name": _name,
            "gameProgression": progressionString,
            "introPercentage": calculate_intro_percentage(_name),
            "outroPercentage": calculate_outro_percentage(_name),
            "playTime": play_time_str,
            "campaign_name": _data.get("campaign_name", "Not Found")
        })

    metric_sums = calculate_metric_sum_per_challenge()
    return {
        "players": playerdata,
        "campaigns": get_campaigns_data(),
        "total_player_amount": calculate_total_players(),
        "finished_player_amount": calculate_finished_players(),
        "metric_sum_per_challenge": metric_sums,
        "metric_sum_per_challenge_increase": calculate_metric_sum_per_challenge_increase(metric_sums),
        "intro_questionaire_average": calculate_intro_questionaire_average(),
        "outro_questionaire_average": calculate_outro_questionaire_average(),
        "questionaire_results": get_questionaire_results()
    }


def add_campaign(new_campaign_name: str, new_campaign_key: str) -> None:
    try:
        with get_session() as session:
            new_c = Campaign(campaign_name=new_campaign_name, campaign_key=new_campaign_key)
            session.add(new_c)
    except Exception:
        pass


def remove_campaign(campaign_key: str) -> None:
    try:
        with get_session() as session:
            session.execute(delete(Campaign).where(Campaign.campaign_key == campaign_key))
    except Exception:
        pass


def get_game_config_dir():
    from pathlib import Path
    base_dir = Path(__file__).parent
    return (base_dir / "../../../../gameConfig").resolve()


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
    return (base_dir / "../../../../gameConfigSchemas").resolve()


def get_game_json_schemas_dir():
    from pathlib import Path
    base_dir = Path(__file__).parent
    return (base_dir / "../../../../gameJsonSchemas").resolve()


def load_json_schema(filename: str) -> dict[str, Any]:
    from pathlib import Path
    import json
    
    safe_name = Path(filename).name
    schema_filename = safe_name.replace(".json", ".schema.json")
    schema_path = get_game_json_schemas_dir() / schema_filename
    
    if not schema_path.exists():
        raise FileNotFoundError(f"JSON Schema file '{schema_filename}' not found in gameJsonSchemas directory.")
    
    with schema_path.open("r", encoding="utf-8") as f:
        return json.load(f)


def load_uischema(filename: str) -> dict[str, Any] | None:
    from pathlib import Path
    import json
    
    safe_name = Path(filename).name
    schema_filename = safe_name.replace(".json", ".uischema.json")
    schema_path = get_game_config_schemas_dir() / schema_filename
    
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

