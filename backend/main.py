from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from backend.core.config import FRONTEND_DIR
from backend.core.security import SESSION_COOKIE, get_session_user
from backend.features.auth.routes import router as auth_router
from backend.features.data_analysis.routes import router as data_analysis_router
from backend.features.data_handling.routes import router as data_handling_router


app = FastAPI(
    title="AI Report Analyst API",
    version="1.0.0"
)


# --------------------------------------------------
# CORS
# --------------------------------------------------

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------
# Browser Caching
# --------------------------------------------------

@app.middleware("http")
async def revalidate_responses(request, call_next):
    """Make browsers check for new frontend files instead of reusing old copies."""
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-cache"
    return response


# --------------------------------------------------
# Health Check
# --------------------------------------------------

@app.get("/api/health")
def root():
    return {
        "message": "AI Report Analyst Backend is running"
    }


# --------------------------------------------------
# Features
# --------------------------------------------------

app.include_router(auth_router)
app.include_router(data_handling_router)
app.include_router(data_analysis_router)


# --------------------------------------------------
# Serve Frontend
# --------------------------------------------------

# Serve frontend static files (CSS, JS)
app.mount(
    "/static",
    StaticFiles(directory=FRONTEND_DIR),
    name="static"
)


def _signed_in(request: Request) -> bool:
    return get_session_user(request.cookies.get(SESSION_COOKIE)) is not None


@app.get("/login")
def login_page(request: Request):
    if _signed_in(request):
        return RedirectResponse("/")
    return FileResponse(FRONTEND_DIR / "login.html")


@app.get("/signup")
def signup_page():
    # Not redirected when signed in, because the page ends on its own success step.
    return FileResponse(FRONTEND_DIR / "signup.html")


# Serve the main app for any other non-API route, after sign-in
@app.get("/{full_path:path}")
async def serve_frontend(full_path: str, request: Request):
    if not _signed_in(request):
        return RedirectResponse("/login")
    return FileResponse(FRONTEND_DIR / "index.html")
