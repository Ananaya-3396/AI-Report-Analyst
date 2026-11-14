"""The one MongoDB connection the whole backend shares."""

from pymongo import MongoClient

from backend.core.config import DB_NAME, MONGO_URI


client = MongoClient(MONGO_URI)

# Uploaded datasets: every collection in this database is shown as a dataset.
db = client[DB_NAME]

# App data (users, sessions, chat history) lives in a separate database,
# which keeps these collections out of the dataset list.
app_db = client[f"{DB_NAME}_app"]


def get_database():
    return db
