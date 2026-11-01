"""Give each distinct dataset a permanent 10-digit ID, based on its contents.

The same rows always get the same ID, even under another collection name, and
changed rows get a new one. This lets saved chats be filtered by the data they
were about, instead of by a name that can be reused.
"""

import hashlib
import json
import secrets
from datetime import datetime, timezone

from pymongo import ReturnDocument

from backend.chat_history import history_db
from backend.database import get_database


registry = history_db["datasets"]


def _new_dataset_id() -> str:
    # A string, because IDs are labels rather than numbers. The first digit is never 0.
    return str(secrets.randbelow(9_000_000_000) + 1_000_000_000)


def _fingerprint(collection) -> str:
    digest = hashlib.sha256()
    for document in collection.find({}, {"_id": 0}).sort("_id", 1):
        digest.update(json.dumps(document, sort_keys=True, default=str).encode("utf-8"))
    return digest.hexdigest()


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
