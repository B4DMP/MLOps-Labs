import datetime
from typing import Any
from pymongo import MongoClient

from philoagents.config import settings
from philoagents.domain.question_factory import QuestionFactory
from philoagents.domain.phase_factory import PhaseFactory


def get_campaign_users(campaign_key: str) -> list[str]:
    try:
        client = MongoClient(settings.MONGO_URI)
        users = []
        db = client[settings.MONGO_DB_NAME]
        for doc in db[settings.MONGO_USER_DATA_COLLECTION].find({"campaign_key": campaign_key}):
            users.append(doc.get("userName"))
        client.close()
        return users
    except Exception:
        return []


def get_campaigns_data() -> list[dict[str, Any]]:
    try:
        client = MongoClient(settings.MONGO_URI)
        db = client[settings.MONGO_DB_NAME]
        campaigns = []
        for doc in db[settings.MONGO_CAMPAIGN_DATA_COLLECTION].find({}):
            campaigns.append({
                "name": doc.get("campaign_name"),
                "key": doc.get("campaign_key"),
                "users": get_campaign_users(doc.get("campaign_key"))
            })
        client.close()
        return campaigns
    except Exception:
        return []


def get_player_data() -> dict[str, Any]:
    try:
        client = MongoClient(settings.MONGO_URI)
        db = client[settings.MONGO_DB_NAME]
        player_data = {}

        for doc in db[settings.MONGO_PROGRESSION_DATA_COLLECTION].find({}):
            player = doc.get("userName")
            if player not in player_data:
                player_data[player] = {
                    "maxProgressIndex": doc.get("gameProgressIndex", 0),
                    "furthestProgression": (0, 0),
                    "lastPlayed": doc.get("timeStamp"),
                    "firstPlayed": doc.get("timeStamp")
                }
            else:
                player_data[player]["maxProgressIndex"] = max(player_data[player]["maxProgressIndex"], doc.get("gameProgressIndex", 0))
                if doc.get("timeStamp") and doc["timeStamp"] > player_data[player]["lastPlayed"]:
                    player_data[player]["lastPlayed"] = doc["timeStamp"]
                if doc.get("timeStamp") and doc["timeStamp"] < player_data[player]["firstPlayed"]:
                    player_data[player]["firstPlayed"] = doc["timeStamp"]

        for doc in db[settings.MONGO_GAME_DATA_COLLECTION].find({}):
            player = doc.get("userName")
            if player not in player_data:
                player_data[player] = {
                    "maxProgressIndex": 2,
                    "furthestProgression": (doc.get("phaseIndex", 0), doc.get("challengeIndex", 0)),
                    "lastPlayed": doc.get("timeStamp")
                }
            else:
                if (doc.get("phaseIndex", 0), doc.get("challengeIndex", 0)) > player_data[player]["furthestProgression"]:
                    player_data[player]["furthestProgression"] = (doc.get("phaseIndex", 0), doc.get("challengeIndex", 0))
                if doc.get("timeStamp") and (not player_data[player]["lastPlayed"] or doc["timeStamp"] > player_data[player]["lastPlayed"]):
                    player_data[player]["lastPlayed"] = doc["timeStamp"]

        for player_doc in db[settings.MONGO_USER_DATA_COLLECTION].find({}):
            user_name = player_doc.get("user_name")
            campaign_key = player_doc.get("campaign_key")
            for campaign_doc in db[settings.MONGO_CAMPAIGN_DATA_COLLECTION].find({}):
                _campaign_key = campaign_doc.get("campaign_key")
                campaign_name = campaign_doc.get("campaign_name")
                if campaign_key == _campaign_key:
                    if user_name in player_data:
                        player_data[user_name]["campaign_name"] = campaign_name
                    break
        client.close()
        return player_data
    except Exception:
        return {}


def get_valid_players_set(db) -> set[str]:
    valid_players = set()
    try:
        for u in db[settings.MONGO_USER_DATA_COLLECTION].find({}):
            user_name = u.get("user_name")
            if user_name is not None:
                valid_players.add(user_name)
    except Exception:
        pass
    return valid_players


def get_finished_players_set(db) -> set[str]:
    finished = set()
    try:
        for doc in db[settings.MONGO_PROGRESSION_DATA_COLLECTION].find({"gameProgressIndex": 4}):
            user_name = doc.get("userName")
            if user_name is not None:
                finished.add(user_name)
    except Exception:
        pass
    return finished


def calculate_intro_percentage(player_name: str) -> int:
    total_questions_amount = 0
    correct_answers_amount = 0
    try:
        client = MongoClient(settings.MONGO_URI)
        db = client[settings.MONGO_DB_NAME]
        doc = db[settings.MONGO_PROGRESSION_DATA_COLLECTION].find_one({"userName": player_name, "gameProgressIndex": 1})

        if doc and "additional_data" in doc:
            additional_data = doc["additional_data"]
            for i, q in enumerate(QuestionFactory.intro_questions):
                if q.knowledge_question:
                    total_questions_amount += 1
                    if i < len(additional_data) and additional_data[i] and "id" in additional_data[i]:
                        if additional_data[i]["id"] == 0:
                            correct_answers_amount += 1
        else:
            client.close()
            return 0

        client.close()
        if total_questions_amount == 0:
            return 0
        return round((correct_answers_amount / total_questions_amount) * 100)
    except Exception:
        return 0


def calculate_outro_percentage(player_name: str) -> int:
    total_questions_amount = 0
    correct_answers_amount = 0
    try:
        client = MongoClient(settings.MONGO_URI)
        db = client[settings.MONGO_DB_NAME]
        doc = db[settings.MONGO_PROGRESSION_DATA_COLLECTION].find_one({"userName": player_name, "gameProgressIndex": 4})

        if doc and "additional_data" in doc:
            additional_data = doc["additional_data"]
            for i, q in enumerate(QuestionFactory.outro_questions):
                if q.knowledge_question:
                    total_questions_amount += 1
                    if i < len(additional_data) and additional_data[i] and "id" in additional_data[i]:
                        if additional_data[i]["id"] == 0:
                            correct_answers_amount += 1
        else:
            client.close()
            return 0

        client.close()
        if total_questions_amount == 0:
            return 0
        return round((correct_answers_amount / total_questions_amount) * 100)
    except Exception:
        return 0


def calculate_intro_questionaire_average() -> int:
    try:
        client = MongoClient(settings.MONGO_URI)
        db = client[settings.MONGO_DB_NAME]
        valid_players = get_valid_players_set(db)
        finished_players = get_finished_players_set(db)
        sum_score = 0
        player_amount = 0
        for doc in db[settings.MONGO_PROGRESSION_DATA_COLLECTION].find({"gameProgressIndex": 1}):
            user = doc.get("userName")
            if user not in valid_players or user not in finished_players:
                continue
            player_score = calculate_intro_percentage(user)
            sum_score += player_score
            player_amount += 1
        client.close()
        if player_amount == 0:
            return 0
        return round(sum_score / player_amount)
    except Exception:
        return 0


def calculate_outro_questionaire_average() -> int:
    try:
        client = MongoClient(settings.MONGO_URI)
        db = client[settings.MONGO_DB_NAME]
        valid_players = get_valid_players_set(db)
        sum_score = 0
        player_amount = 0
        for doc in db[settings.MONGO_PROGRESSION_DATA_COLLECTION].find({"gameProgressIndex": 4}):
            user = doc.get("userName")
            if user not in valid_players:
                continue
            player_score = calculate_outro_percentage(user)
            sum_score += player_score
            player_amount += 1
        client.close()
        if player_amount == 0:
            return 0
        return round(sum_score / player_amount)
    except Exception:
        return 0


def calculate_total_players() -> int:
    try:
        client = MongoClient(settings.MONGO_URI)
        db = client[settings.MONGO_DB_NAME]
        amount = db[settings.MONGO_PROGRESSION_DATA_COLLECTION].count_documents({"gameProgressIndex": 1})
        client.close()
        return amount
    except Exception:
        return 0


def calculate_finished_players() -> int:
    try:
        client = MongoClient(settings.MONGO_URI)
        db = client[settings.MONGO_DB_NAME]
        valid_players = get_valid_players_set(db)
        amount = 0
        for doc in db[settings.MONGO_PROGRESSION_DATA_COLLECTION].find({"gameProgressIndex": 4}):
            if doc.get("userName") in valid_players:
                amount += 1
        client.close()
        return amount
    except Exception:
        return 0


def calculate_metric_sum_per_challenge() -> list[float]:
    try:
        short = True
        sum_per_challenge = []
        client = MongoClient(settings.MONGO_URI)
        db = client[settings.MONGO_DB_NAME]

        valid_players = get_valid_players_set(db)
        full_players = set()
        for doc in db[settings.MONGO_GAME_DATA_COLLECTION].find({"challengeIndex": {"$gt": 0}}):
            user = doc.get("userName")
            if user and user in valid_players:
                full_players.add(user)

        for p_id, phase in enumerate(PhaseFactory.phases):
            if p_id == 0:
                continue
            is_last_phase = (p_id == len(PhaseFactory.phases) - 1)
            for c_id, challenge in enumerate(phase.challenges):
                total_metrics = 0
                players_amount = 0
                is_last_challenge = (c_id == len(phase.challenges) - 1)
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

                for doc in db[settings.MONGO_GAME_DATA_COLLECTION].find({"phaseIndex": target_p_id}):
                    user = doc.get("userName")
                    if user not in valid_players:
                        continue
                    doc_c_id = doc.get("challengeIndex")

                    if doc_c_id == target_c_id:
                        metric_values = doc.get("metricValues")
                        if metric_values and len(metric_values) >= 6:
                            total_metrics += sum(metric_values[:6])
                            players_amount += 1

                if players_amount > 0:
                    sum_per_challenge.append(total_metrics / players_amount)
                else:
                    sum_per_challenge.append(0)

        client.close()
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
    ret = {"intro": [], "outro": []}
    try:
        client = MongoClient(settings.MONGO_URI)
        db = client[settings.MONGO_DB_NAME]
        valid_players = get_valid_players_set(db)
        finished_players = get_finished_players_set(db)
        expert_players = set()
        try:
            for doc in db[settings.MONGO_PROGRESSION_DATA_COLLECTION].find({"gameProgressIndex": 1}):
                user = doc.get("userName")
                if user not in valid_players or user not in finished_players:
                    continue
                additional_data = doc.get("additional_data", [])
                if len(additional_data) > 0 and additional_data[0]:
                    ans_id = additional_data[0].get("id", 0)
                    if ans_id in (1, 2, 5):
                        expert_players.add(user)
        except Exception as e:
            print(f"Error identifying expert players: {e}")

        try:
            intro_docs = list(db[settings.MONGO_PROGRESSION_DATA_COLLECTION].find({"gameProgressIndex": 1}))
            outro_docs = list(db[settings.MONGO_PROGRESSION_DATA_COLLECTION].find({"gameProgressIndex": 4}))

            for i, q in enumerate(QuestionFactory.intro_questions):
                answer_dict = [{"answer_name": ans["text"], "amount": 0, "amount_experts": 0, "notes": []} for ans in q.answers]
                if not answer_dict:
                    answer_dict = [{"answer_name": "Written Feedback", "amount": 0, "amount_experts": 0, "notes": []}]
                for doc in intro_docs:
                    user = doc.get("userName")
                    if user not in valid_players or user not in finished_players:
                        continue
                    additional_data = doc.get("additional_data", [])
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
                answer_dict = [{"answer_name": ans["text"], "amount": 0, "amount_experts": 0, "notes": []} for ans in q.answers]
                if not answer_dict:
                    answer_dict = [{"answer_name": "Written Feedback", "amount": 0, "amount_experts": 0, "notes": []}]
                for doc in outro_docs:
                    user = doc.get("userName")
                    if user not in valid_players or user not in finished_players:
                        continue
                    additional_data = doc.get("additional_data", [])
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

            client.close()
            return ret
        except Exception as e:
            print(f"Error processing questions: {e}")
            client.close()
            return {"intro": [], "outro": []}
    except Exception as e:
        print(f"Connection error: {e}")
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
        client = MongoClient(settings.MONGO_URI)
        db = client[settings.MONGO_DB_NAME]
        db[settings.MONGO_CAMPAIGN_DATA_COLLECTION].insert_one({
            "campaign_name": new_campaign_name,
            "campaign_key": new_campaign_key
        })
        client.close()
    except Exception:
        pass


def remove_campaign(campaign_key: str) -> None:
    try:
        client = MongoClient(settings.MONGO_URI)
        db = client[settings.MONGO_DB_NAME]
        db[settings.MONGO_CAMPAIGN_DATA_COLLECTION].delete_one({
            "campaign_key": campaign_key
        })
        client.close()
    except Exception:
        pass
