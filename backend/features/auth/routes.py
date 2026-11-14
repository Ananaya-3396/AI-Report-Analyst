import asyncio
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse, JSONResponse

from backend.controllers.auth import (
    MAX_AVATAR_BYTES,
    AuthError,
    authenticate,
    avatar_path,
    create_user,
    is_taken,
    public_user,
)
from backend.core.config import SECURE_COOKIES
from backend.core.security import SESSION_COOKIE, create_session, current_user, end_session
from backend.features.auth.schemas import AvailabilityRequest, LoginRequest


router = APIRouter(prefix="/api/auth", tags=["auth"])

Industry = Literal["Finance", "Healthcare", "Retail", "Technology", "Education", "Other"]


def _auth_error(exc: AuthError) -> JSONResponse:
    # `field` lets the page put the message under the right input.
    return JSONResponse(status_code=exc.status_code, content={"detail": str(exc), "field": exc.field})


def _start_session(response: Response, user: dict, remember: bool) -> None:
    token, max_age = create_session(user["_id"], remember)
    response.set_cookie(
        SESSION_COOKIE,
        token,
        # Without "Remember me" the cookie ends when the browser closes.
        max_age=max_age if remember else None,
        httponly=True,
        samesite="lax",
        secure=SECURE_COOKIES,
    )


@router.post("/register", status_code=201)
async def register(
    response: Response,
    full_name: str = Form(..., min_length=1, max_length=100),
    email: str = Form(..., max_length=254),
    password: str = Form(..., max_length=128),
    phone: str | None = Form(default=None, max_length=20),
    age: int | None = Form(default=None, ge=13, le=120),
    company: str | None = Form(default=None, max_length=120),
    job_title: str | None = Form(default=None, max_length=120),
    industry: Industry | None = Form(default=None),
    avatar: UploadFile | None = File(default=None),
):
    """Create an account from both sign-up steps and sign the new user in."""
    avatar_bytes = None
    if avatar and avatar.filename:
        # Reading one byte past the limit is enough to know the file is too big.
        avatar_bytes = await avatar.read(MAX_AVATAR_BYTES + 1)

    details = {
        "full_name": full_name, "email": email, "password": password, "phone": phone,
        "age": age, "company": company, "job_title": job_title, "industry": industry,
    }
    try:
        user = await asyncio.to_thread(create_user, details, avatar_bytes)
    except AuthError as exc:
        return _auth_error(exc)

    _start_session(response, user, remember=False)
    return {"user": public_user(user)}


@router.post("/check-availability")
def check_availability(request: AvailabilityRequest):
    """Let sign-up step 1 warn about a registered email or phone before step 2."""
    try:
        return is_taken(request.email, request.phone)
    except AuthError as exc:
        return _auth_error(exc)


@router.post("/login")
async def login(request: LoginRequest, response: Response):
    user = await asyncio.to_thread(authenticate, request.identifier, request.password)
    if not user:
        raise HTTPException(status_code=401, detail="Incorrect email/phone or password.")
    _start_session(response, user, request.remember)
    return {"user": public_user(user)}


@router.post("/logout")
def logout(request: Request, response: Response):
    """End the session on the server and remove the cookie. Safe to call when signed out."""
    end_session(request.cookies.get(SESSION_COOKIE))
    response.delete_cookie(SESSION_COOKIE, httponly=True, samesite="lax", secure=SECURE_COOKIES)
    return {"logged_out": True}


@router.get("/me")
def me(user: dict = Depends(current_user)):
    return {"user": public_user(user)}


@router.get("/me/avatar")
def my_avatar(user: dict = Depends(current_user)):
    path = avatar_path(user)
    if not path:
        raise HTTPException(status_code=404, detail="No profile photo.")
    return FileResponse(path)
