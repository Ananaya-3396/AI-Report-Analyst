"""Helpers for the data analysis feature: dataset profiling (EDA) and the saved chat.

The chat is saved in MongoDB, so it survives restarts and changes of port or browser.
Each question and its answer are one "turn" document, which keeps them ready for
later uses such as searching past questions. App notes, such as a dataset being
uploaded, are "note" documents, so they stay in the transcript without looking
like questions.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

import pandas as pd
from bson import ObjectId

from backend.core.database import app_db, get_database


MAX_PROFILE_ROWS = 100_000
MAX_PROFILE_COLUMNS = 100
PREVIEW_ROWS = 5
MAX_RESTORED_ITEMS = 100

conversations = app_db["conversations"]
settings = app_db["chat_settings"]


# --------------------------------------------------
# Profiling (EDA)
# --------------------------------------------------

def get_dataset_schema(dataset_name: str) -> dict:
    """Return column names and inferred types from a small MongoDB sample."""
    db = get_database()
    if dataset_name not in db.list_collection_names():
        raise KeyError(dataset_name)

    collection = db[dataset_name]
    total_rows = collection.count_documents({})
    documents = list(
        collection.find({}, {"_id": 0}).limit(1_000)
    )
    if not documents:
        raise ValueError("The selected dataset has no rows.")

    df = pd.DataFrame.from_records(documents)
    return {
        "dataset_name": dataset_name,
        "row_count": total_rows,
        "inspected_rows": len(df),
        "sampled": total_rows > len(df),
        "columns": [
            {"name": str(name), "type": str(dtype)}
            for name, dtype in df.dtypes.items()
        ],
    }


def profile_dataset(dataset_name: str) -> dict:
    db = get_database()
    if dataset_name not in db.list_collection_names():
        raise KeyError(dataset_name)

    collection = db[dataset_name]
    total_rows = collection.count_documents({})
    documents = list(
        collection.find({}, {"_id": 0}).limit(MAX_PROFILE_ROWS)
    )
    if not documents:
        raise ValueError("The selected dataset has no rows to profile.")

    df = pd.DataFrame.from_records(documents)
    total_columns = len(df.columns)
    omitted_columns = max(0, total_columns - MAX_PROFILE_COLUMNS)
    df = df.iloc[:, :MAX_PROFILE_COLUMNS]

    columns = []
    for name in df.columns:
        series = df[name]
        sample_values = series.dropna().astype(str).drop_duplicates().head(5).tolist()
        columns.append({
            "name": str(name),
            "dtype": str(series.dtype),
            "non_null_count": int(series.notna().sum()),
            "missing_count": int(series.isna().sum()),
            "missing_percent": round(float(series.isna().mean() * 100), 2),
            "distinct_count": int(series.nunique(dropna=True)),
            "sample_values": sample_values,
        })

    describe = df.describe(include="all").transpose()
    describe_json = json.loads(describe.to_json(orient="index", date_format="iso"))
    preview = json.loads(
        df.head(PREVIEW_ROWS).to_json(orient="records", date_format="iso")
    )

    return {
        "dataset_name": dataset_name,
        "row_count": total_rows,
        "profiled_row_count": len(df),
        "sampled_rows": total_rows > len(df),
        "column_count": total_columns,
        "profiled_column_count": len(df.columns),
        "omitted_column_count": omitted_columns,
        "columns": columns,
        "preview": preview,
        "describe": describe_json,
    }


# --------------------------------------------------
# Chat history
# --------------------------------------------------

def load_history() -> dict:
    """Return recent chat summaries. Pre-thread history is exposed as one legacy chat."""
    latest = list(conversations.find({}).sort("_id", -1).limit(MAX_RESTORED_ITEMS))
    groups: dict[str, list[dict]] = {}
    for item in latest:
        chat_id = item.get("chat_id", "legacy")
        groups.setdefault(chat_id, []).append(item)
    chats = []
    for chat_id, items in groups.items():
        items.sort(key=lambda item: item["_id"])
        first_turn = next((item for item in items if item.get("type") == "turn"), None)
        last = items[-1]
        chats.append({
            "chat_id": chat_id,
            "title": (first_turn or last).get("question") or (first_turn or last).get("content") or "New chat",
            "dataset": next((item.get("dataset") for item in reversed(items) if item.get("dataset")), None),
            "updated_at": last.get("created_at"),
            "item_count": len(items),
        })
    chats.sort(key=lambda chat: str(chat["updated_at"] or ""), reverse=True)
    return {"chats": chats}


def load_chat(chat_id: str) -> dict:
    if chat_id == "legacy":
        query = {"$or": [{"chat_id": "legacy"}, {"chat_id": {"$exists": False}}]}
    else:
        query = {"chat_id": chat_id}
    items = conversations.find(query).sort("_id", 1)
    return {"items": [{**item, "_id": str(item["_id"])} for item in items]}


def save_turn(
    question: str,
    answer: str,
    cells: list[dict],
    dataset: str | None,
    dataset_id: str | None,
    replaces_id: str | None = None,
    chat_id: str = "legacy",
) -> str:
    """Save a turn and return its ID. When editing, remove the old turn and all that followed."""
    result = conversations.insert_one({
        "type": "turn",
        "chat_id": chat_id,
        "question": question,
        "answer": answer,
        "cells": cells,
        "dataset": dataset,
        "dataset_id": dataset_id,
        "created_at": datetime.now(timezone.utc),
    })
    # Deleting only after the new turn is stored means a failed save cannot lose history.
    if replaces_id:
        chat_scope = {"chat_id": chat_id}
        if chat_id == "legacy":
            chat_scope = {"$or": [{"chat_id": "legacy"}, {"chat_id": {"$exists": False}}]}
        conversations.delete_many({
            **chat_scope,
            "_id": {"$gte": ObjectId(replaces_id), "$lt": result.inserted_id},
        })
    return str(result.inserted_id)


def save_note(content: str, chat_id: str = "legacy") -> str:
    result = conversations.insert_one({
        "type": "note",
        "chat_id": chat_id,
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


def clear_selected_dataset_if(dataset_name: str) -> None:
    """Unselect a dataset that no longer exists, leaving any other selection alone."""
    settings.update_one(
        {"_id": "selected_dataset", "value": dataset_name},
        {"$set": {"value": None}},
    )


def clear_history() -> None:
    """Permanently delete all saved turns and notes. The selected dataset is kept."""
    conversations.delete_many({})
