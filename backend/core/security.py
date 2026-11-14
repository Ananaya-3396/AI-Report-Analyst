"""Password hashing and login sessions.

A session is a random token kept in an HttpOnly cookie. Only its SHA-256 hash is
stored, so a leaked database cannot be used to log in, and logging out deletes
the record, which ends the session at once.
"""

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, Request

from backend.core.config import SESSION_HOURS, SESSION_REMEMBER_DAYS
from backend.core.database import app_db


SESSION_COOKIE = "session"

users = app_db["users"]
sessions = app_db["sessions"]
# MongoDB removes sessions by itself once they expire.
sessions.create_index("expires_at", expireAfterSeconds=0)
users.create_index("email", unique=True)
users.create_index("phone", unique=True, sparse=True)

# scrypt settings: about 16 MB of memory per hash, which makes guessing slow.
_SCRYPT = {"n": 2**14, "r": 8, "p": 1}


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, **_SCRYPT)
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, salt_hex, digest_hex = stored.split("$")
    except ValueError:
        return False
    digest = hashlib.scrypt(password.encode("utf-8"), salt=bytes.fromhex(salt_hex), **_SCRYPT)
    return hmac.compare_digest(digest.hex(), digest_hex)


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_session(user_id, remember: bool) -> tuple[str, int]:
    """Start a session and return its token and lifetime in seconds."""
    lifetime = timedelta(days=SESSION_REMEMBER_DAYS) if remember else timedelta(hours=SESSION_HOURS)
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    sessions.insert_one({
        "_id": _hash_token(token),
        "user_id": user_id,
        "created_at": now,
        "expires_at": now + lifetime,
    })
    return token, int(lifetime.total_seconds())


def end_session(token: str | None) -> None:
    if token:
        sessions.delete_one({"_id": _hash_token(token)})


def get_session_user(token: str | None) -> dict | None:
    """Return the logged-in user for a session token, or None."""
    if not token:
        return None
    session = sessions.find_one({"_id": _hash_token(token)})
    # The TTL index runs about once a minute, so check the time here too.
    if not session or session["expires_at"].replace(tzinfo=timezone.utc) <= datetime.now(timezone.utc):
        return None
    return users.find_one({"_id": session["user_id"]})


def current_user(request: Request) -> dict:
    """Route dependency: the logged-in user, or a 401 error."""
    user = get_session_user(request.cookies.get(SESSION_COOKIE))
    if not user:
        raise HTTPException(status_code=401, detail="Please sign in to continue.")
    return user
