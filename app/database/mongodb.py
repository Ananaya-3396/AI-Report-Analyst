from pymongo import MongoClient

from app.config.settings import settings


client = MongoClient(settings.mongo_uri)

db = client[settings.mongo_database]


def get_database():
    return db