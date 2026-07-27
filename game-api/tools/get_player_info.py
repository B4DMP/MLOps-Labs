import datetime
from typing import Any

import click
from pymongo import MongoClient
from philoagents.config import settings


@click.command()
def main() -> None:
    """
    Display player progress
    """
    try:
        client = MongoClient(settings.MONGO_URI)
        db = client[settings.MONGO_DB_NAME]
        player_data = {}

        for doc in db[settings.MONGO_PROGRESSION_DATA_COLLECTION].find({}):
            player = doc.get("userName")
            
            if player not in player_data:
                player_data[player] = {
                    "maxProgressIndex": doc.get("gameProgressIndex", 0),
                    "furthestProgression": (0,0),
                    "lastPlayed": doc.get("timeStamp")
                }
            else:
                # Update with higher values if found
                player_data[player]["maxProgressIndex"] = max(player_data[player]["maxProgressIndex"], doc.get("gameProgressIndex", 0))
                if doc.get("timeStamp") and doc["timeStamp"] > player_data[player]["lastPlayed"]:
                    player_data[player]["lastPlayed"] = doc["timeStamp"]

        for doc in db[settings.MONGO_GAME_DATA_COLLECTION].find({}):
            player = doc.get("userName")

            if player not in player_data:
                player_data[player] = {
                    "maxProgressIndex": 2, 
                    "furthestProgression": (doc.get("phaseIndex", 0), doc.get("challengeIndex", 0)),
                    "lastPlayed": doc.get("timeStamp")
                }
            else:
                # Update with higher values if found
                if (doc.get("phaseIndex", 0), doc.get("challengeIndex", 0)) >  player_data[player]["furthestProgression"]:
                    player_data[player]["furthestProgression"] = (doc.get("phaseIndex", 0), doc.get("challengeIndex", 0))
                
                if doc.get("timeStamp") and (not player_data[player]["lastPlayed"] or doc["timeStamp"] > player_data[player]["lastPlayed"]):
                    player_data[player]["lastPlayed"] = doc["timeStamp"]

        client.close()
        for p in player_data:
            print(p, f"Game completed?: {player_data[p]['maxProgressIndex']==5}, ",  f"furthestProgression: {player_data[p]['furthestProgression']}, LastPlayed: {player_data[p]['lastPlayed']}")
        
    except Exception as e:
        print(f"Error accessing MongoDB: {e}")


if __name__ == "__main__":
    main()
