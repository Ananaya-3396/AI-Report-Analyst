"""Helpers for the auth feature: creating users, checking logins and profile photos."""

import re
from datetime import datetime, timezone

from pymongo.errors import DuplicateKeyError

from backend.core.config import UPLOADS_DIR
from backend.core.security import hash_password, users, verify_password


AVATARS_DIR = UPLOADS_DIR / "avatars"
MAX_AVATAR_BYTES = 2 * 1024 * 1024
DEFAULT_COUNTRY_CODE = "+91"
# Image types are checked from the file's first bytes, not from its name.
AVATAR_SIGNATURES = {
    b"\x89PNG\r\n\x1a\n": "png",
    b"\xff\xd8\xff": "jpg",
}
EMAIL_PATTERN = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")


class AuthError(ValueError):
    """A user-facing problem with the submitted details. `field` names the input it belongs to."""

    def __init__(self, message: str, field: str | None = None, status_code: int = 400):
        super().__init__(message)
        self.field = field
        self.status_code = status_code


def normalize_email(email: str) -> str:
    email = email.strip().lower()
    if not EMAIL_PATTERN.fullmatch(email):
        raise AuthError("Enter a valid email address.", field="email")
    return email


def normalize_phone(phone: str) -> str:
    """Return the phone as + and digits. Numbers without a country code get DEFAULT_COUNTRY_CODE."""
    digits = re.sub(r"\D", "", phone)
    if phone.strip().startswith("+"):
        number = f"+{digits}"
    else:
        number = f"{DEFAULT_COUNTRY_CODE}{digits.lstrip('0')}"
    if not 8 <= len(number) - 1 <= 15:
        raise AuthError("Enter a valid phone number.", field="phone")
    return number


def check_password_strength(password: str) -> None:
    if len(password) < 8 or not re.search(r"\d", password) or not re.search(r"[^A-Za-z0-9]", password):
        raise AuthError(
            "Use at least 8 characters, with a number and a symbol.", field="password"
        )


def is_taken(email: str | None = None, phone: str | None = None) -> dict:
    """Say which of the given email and phone already belong to an account."""
    taken = {}
    if email:
        taken["email"] = users.count_documents({"email": normalize_email(email)}, limit=1) > 0
    if phone:
        taken["phone"] = users.count_documents({"phone": normalize_phone(phone)}, limit=1) > 0
    return taken


def check_avatar(content: bytes) -> str:
    """Return the image's file extension, or raise if it is not a small PNG or JPEG."""
    if len(content) > MAX_AVATAR_BYTES:
        raise AuthError("The photo must be 2 MB or smaller.", field="avatar")
    for signature, extension in AVATAR_SIGNATURES.items():
        if content.startswith(signature):
            return extension
    raise AuthError("The photo must be a JPG or PNG image.", field="avatar")


def create_user(details: dict, avatar: bytes | None) -> dict:
    """Store a new user and their optional photo, and return the user record."""
    email = normalize_email(details["email"])
    phone = normalize_phone(details["phone"]) if details.get("phone") else None
    check_password_strength(details["password"])
    avatar_extension = check_avatar(avatar) if avatar else None

    user = {
        "full_name": details["full_name"].strip(),
        "email": email,
        "password_hash": hash_password(details["password"]),
        "age": details.get("age"),
        "company": (details.get("company") or "").strip() or None,
        "job_title": (details.get("job_title") or "").strip() or None,
        "industry": details.get("industry") or None,
        "avatar": None,
        "created_at": datetime.now(timezone.utc),
    }
    # Left out when empty, so the unique phone index ignores users without one.
    if phone:
        user["phone"] = phone

    try:
        user["_id"] = users.insert_one(user).inserted_id
    except DuplicateKeyError as exc:
        field = "phone" if "phone" in str(exc) else "email"
        raise AuthError(
            f"An account with this {field} already exists.", field=field, status_code=409
        ) from exc

    if avatar_extension:
        AVATARS_DIR.mkdir(parents=True, exist_ok=True)
        filename = f"{user['_id']}.{avatar_extension}"
        (AVATARS_DIR / filename).write_bytes(avatar)
        users.update_one({"_id": user["_id"]}, {"$set": {"avatar": filename}})
        user["avatar"] = filename
    return user


def authenticate(identifier: str, password: str) -> dict | None:
    """Return the user whose email or phone and password match, or None."""
    try:
        query = (
            {"email": normalize_email(identifier)}
            if "@" in identifier
            else {"phone": normalize_phone(identifier)}
        )
    except AuthError:
        return None
    user = users.find_one(query)
    if not user or not verify_password(password, user["password_hash"]):
        return None
    return user


def public_user(user: dict) -> dict:
    """The user fields that are safe to send to the browser."""
    return {
        "id": str(user["_id"]),
        "full_name": user["full_name"],
        "email": user["email"],
        "phone": user.get("phone"),
        "age": user.get("age"),
        "company": user.get("company"),
        "job_title": user.get("job_title"),
        "industry": user.get("industry"),
        "has_avatar": bool(user.get("avatar")),
    }


def avatar_path(user: dict):
    """Return the path of the user's photo, or None if they have none."""
    if not user.get("avatar"):
        return None
    path = AVATARS_DIR / user["avatar"]
    return path if path.exists() else None
