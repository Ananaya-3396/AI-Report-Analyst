"""Helpers for the data handling feature: storing, listing and deleting datasets.

Each distinct dataset also gets a permanent 10-digit ID, based on its contents.
The same rows always get the same ID, even under another collection name, and
changed rows get a new one. This lets saved chats be filtered by the data they
were about, instead of by a name that can be reused.
"""

import hashlib
import io
import json
import secrets
from datetime import datetime, timezone

import pandas as pd
from pymongo import ReturnDocument

from backend.core.database import app_db, db, get_database


SUPPORTED_EXTENSIONS = (".csv", ".xlsx", ".xls")

registry = app_db["datasets"]


# --------------------------------------------------
# Dataset collections
# --------------------------------------------------

def get_dataset_names():
    """
    Returns MongoDB collections that can be treated as datasets.
    """

    collections = db.list_collection_names()

    # Ignore MongoDB/system collections if required
    collections = [
        collection
        for collection in collections
        if not collection.startswith("system.")
    ]

    return collections


def insert_dataset(collection_name, records):
    """
    Insert uploaded CSV/Excel records into MongoDB.
    """

    if not records:
        return 0

    collection = db[collection_name]

    result = collection.insert_many(records)

    return len(result.inserted_ids)


def delete_dataset(collection_name):
    """
    Permanently drop a dataset collection and all of its rows.
    """

    db.drop_collection(collection_name)


def read_uploaded_file(filename: str, file_content: bytes) -> pd.DataFrame:
    """Read a CSV or Excel upload into a DataFrame, with NaN turned into None for MongoDB."""
    if filename.lower().endswith(".csv"):
        df = pd.read_csv(io.BytesIO(file_content))
    else:
        df = pd.read_excel(io.BytesIO(file_content))
    return df.where(pd.notnull(df), None)


# --------------------------------------------------
# Dataset IDs
# --------------------------------------------------

def _new_dataset_id() -> str:
    # A string, because IDs are labels rather than numbers. The first digit is never 0.
    return str(secrets.randbelow(9_000_000_000) + 1_000_000_000)


def _fingerprint(collection) -> str:
    digest = hashlib.sha256()
    for document in collection.find({}, {"_id": 0}).sort("_id", 1):
        digest.update(json.dumps(document, sort_keys=True, default=str).encode("utf-8"))
    return digest.hexdigest()


def forget_dataset_name(dataset_name: str) -> None:
    """Unlink a deleted collection's name, so a later upload under that name gets its own ID.

    The ID record stays, because saved chats still refer to it.
    """
    registry.update_many({"names": dataset_name}, {"$pull": {"names": dataset_name}})


def get_dataset_id(dataset_name: str) -> str:
    """Return the collection's ID, registering it the first time it is seen."""
    collection = get_database()[dataset_name]
    row_count = collection.count_documents({})

    # The row count is a cheap way to notice replaced data without rehashing every time.
    known = registry.find_one({"names": dataset_name})
    if known and known["row_count"] == row_count:
        return known["_id"]

    fingerprint = _fingerprint(collection)
    if known:
        registry.update_one({"_id": known["_id"]}, {"$pull": {"names": dataset_name}})

    record = registry.find_one_and_update(
        {"fingerprint": fingerprint},
        {
            "$setOnInsert": {
                "_id": _new_dataset_id(),
                "row_count": row_count,
                "created_at": datetime.now(timezone.utc),
            },
            "$addToSet": {"names": dataset_name},
        },
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return record["_id"]
