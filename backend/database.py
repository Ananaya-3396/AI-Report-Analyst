import os
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv()

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/")
DB_NAME = os.getenv("MONGO_DB_NAME", "AI_Report_Database")

client = MongoClient(MONGO_URI)
db = client[DB_NAME]


def get_database():
    return db


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
