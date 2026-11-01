"""Save the chat in MongoDB, so it survives restarts and changes of port or browser.

Each question and its answer are one "turn" document, which keeps them ready for
later uses such as searching past questions. App notes, such as a dataset being
uploaded, are "note" documents, so they stay in the transcript without looking
like questions.
"""

from datetime import datetime, timezone

from bson import ObjectId

from backend.database import DB_NAME, client


MAX_RESTORED_ITEMS = 100

# A separate database keeps these collections out of the dataset list.
history_db = client[f"{DB_NAME}_app"]
conversations = history_db["conversations"]
settings = history_db["chat_settings"]


def load_history() -> dict:
    """Return the latest turns and notes, oldest first, and the selected dataset."""
    latest = conversations.find({}).sort("_id", -1).limit(MAX_RESTORED_ITEMS)
    selection = settings.find_one({"_id": "selected_dataset"}) or {}
    items = [{**item, "_id": str(item["_id"])} for item in latest]
    return {
        "items": items[::-1],
        "selected_dataset": selection.get("value"),
    }


def save_turn(
    question: str,
    answer: str,
    cells: list[dict],
    dataset: str | None,
    dataset_id: str | None,
    replaces_id: str | None = None,
) -> str:
    """Save a turn and return its ID. When editing, remove the old turn and all that followed."""
    result = conversations.insert_one({
        "type": "turn",
        "question": question,
        "answer": answer,
        "cells": cells,
        "dataset": dataset,
        "dataset_id": dataset_id,
        "created_at": datetime.now(timezone.utc),
    })
    # Deleting only after the new turn is stored means a failed save cannot lose history.
    if replaces_id:
        conversations.delete_many({
            "_id": {"$gte": ObjectId(replaces_id), "$lt": result.inserted_id},
        })
    return str(result.inserted_id)


def save_note(content: str) -> str:
    result = conversations.insert_one({
        "type": "note",
        "content": content,
        "created_at": datetime.now(timezone.utc),
    })
    return str(result.inserted_id)


def save_selected_dataset(dataset_name: str | None) -> None:
    settings.update_one(
        {"_id": "selected_dataset"},
        {"$set": {"value": dataset_name}},
        upsert=True,
    )


def clear_history() -> None:
    """Permanently delete all saved turns and notes. The selected dataset is kept."""
    conversations.delete_many({})
