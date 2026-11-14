"""Settings read from .env, in one place so every feature uses the same values."""

import os
from pathlib import Path

from dotenv import load_dotenv


load_dotenv()


def _flag(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).strip().lower() in {"1", "true", "yes", "on"}


PROJECT_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_DIR = PROJECT_ROOT / "frontend"
UPLOADS_DIR = PROJECT_ROOT / "uploads"

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/")
DB_NAME = os.getenv("MONGO_DB_NAME", "AI_Report_Database")

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip()
DEBUG_LLM_IO = _flag("DEBUG_LLM_IO")

# A login lasts this long without "Remember me", and SESSION_REMEMBER_DAYS with it.
SESSION_HOURS = int(os.getenv("SESSION_HOURS", "12"))
SESSION_REMEMBER_DAYS = int(os.getenv("SESSION_REMEMBER_DAYS", "30"))
# Set to true when the site is served over HTTPS, so the login cookie is never sent over HTTP.
SECURE_COOKIES = _flag("SECURE_COOKIES")
