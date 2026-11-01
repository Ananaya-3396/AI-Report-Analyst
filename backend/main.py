from typing import Literal

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from bson import ObjectId

import asyncio
import logging
import pandas as pd
import io
import re

from backend.analysis import run_code
from backend.chat_history import (
    clear_history,
    load_history,
    save_note,
    save_selected_dataset,
    save_turn,
)
from backend.database import (
    DB_NAME,
    get_dataset_names,
    insert_dataset
)
from backend.dataset_registry import get_dataset_id
from backend.llm import (
    LLMConfigurationError,
    LLMProviderError,
    generate_dataset_overview,
    generate_reply,
)
from backend.profiling import get_dataset_schema, profile_dataset


logger = logging.getLogger(__name__)

app = FastAPI(
    title="AI Report Analyst API",
    version="1.0.0"
)


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=20)
    selected_dataset: str | None = Field(default=None, max_length=120)
    replaces_id: str | None = Field(default=None, max_length=24)


class SavedNote(BaseModel):
    content: str = Field(min_length=1, max_length=4000)


class SelectedDatasetUpdate(BaseModel):
    selected_dataset: str | None = Field(default=None, max_length=120)


class ChatResponse(BaseModel):
    reply: str
    cells: list[dict] = []
    turn_id: str | None = None


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


@app.post("/api/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """Answer a chat message, running analysis code on the selected dataset as needed."""
    if request.replaces_id and not ObjectId.is_valid(request.replaces_id):
        raise HTTPException(status_code=400, detail="The edited message was not found.")

    dataset_schema = None
    run_cell = None
    if request.selected_dataset:
        try:
            dataset_schema = get_dataset_schema(request.selected_dataset)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Selected dataset was not found.") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        async def run_cell(code: str) -> dict:
            return await asyncio.to_thread(run_code, request.selected_dataset, code)

    try:
        reply, cells = await generate_reply(
            messages=[message.model_dump() for message in request.messages],
            selected_dataset=request.selected_dataset,
            dataset_schema=dataset_schema,
            run_code=run_cell,
        )
        question = next(
            message.content for message in reversed(request.messages) if message.role == "user"
        )
        turn_id = None
        try:
            dataset_id = None
            if request.selected_dataset:
                dataset_id = await asyncio.to_thread(get_dataset_id, request.selected_dataset)
            turn_id = await asyncio.to_thread(
                save_turn,
                question,
                reply,
                cells,
                request.selected_dataset,
                dataset_id,
                request.replaces_id,
            )
        except Exception:
            # The answer is still worth returning if it could not be saved.
            logger.exception("Could not save the chat turn.")
        return ChatResponse(reply=reply, cells=cells, turn_id=turn_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Selected dataset was not found.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except LLMConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except LLMProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


# --------------------------------------------------
# Chat History
# --------------------------------------------------

@app.get("/api/chat/history")
def get_chat_history():
    return load_history()


@app.post("/api/chat/notes", status_code=201)
def add_chat_note(note: SavedNote):
    return {"id": save_note(note.content)}


@app.put("/api/chat/selected-dataset")
def update_selected_dataset(update: SelectedDatasetUpdate):
    save_selected_dataset(update.selected_dataset)
    return {"saved": True}


@app.delete("/api/chat/history")
def delete_chat_history():
    clear_history()
    return {"cleared": True}


# --------------------------------------------------
# Get MongoDB Datasets
# --------------------------------------------------

@app.get("/datasets")
def get_datasets():

    datasets = get_dataset_names()

    return {
        "database": DB_NAME,
        "datasets": datasets
    }


@app.post("/api/datasets/{dataset_name}/profile")
async def get_dataset_profile(dataset_name: str):
    """Compute a Pandas profile and ask the LLM to explain those measurements."""
    try:
        profile = profile_dataset(dataset_name)
        overview = await generate_dataset_overview(profile)
        return {"profile": profile, "overview": overview}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Dataset collection was not found.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except LLMConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except LLMProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


# --------------------------------------------------
# Upload CSV / Excel
# --------------------------------------------------

@app.post("/upload-dataset")
async def upload_dataset(
    file: UploadFile = File(...),
    collection_name: str = Form(...)
):

    collection_name = collection_name.strip()
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,120}", collection_name):
        raise HTTPException(
            status_code=400,
            detail="Collection name must be 1–120 characters and use only letters, numbers, underscores, or hyphens."
        )

    if collection_name in get_dataset_names():
        raise HTTPException(
            status_code=409,
            detail=f"A collection named '{collection_name}' already exists in {DB_NAME}. Choose another name."
        )

    filename = file.filename.lower()

    if not (
        filename.endswith(".csv")
        or filename.endswith(".xlsx")
        or filename.endswith(".xls")
    ):
        raise HTTPException(
            status_code=400,
            detail="Only CSV and Excel files are supported."
        )

    try:

        file_content = await file.read()

        # -----------------------------
        # Read CSV
        # -----------------------------

        if filename.endswith(".csv"):

            df = pd.read_csv(
                io.BytesIO(file_content)
            )

        # -----------------------------
        # Read Excel
        # -----------------------------

        else:

            df = pd.read_excel(
                io.BytesIO(file_content)
            )

        if df.empty:

            raise HTTPException(
                status_code=400,
                detail="Uploaded file is empty."
            )

        # -----------------------------
        # Convert NaN to None
        # -----------------------------

        df = df.where(
            pd.notnull(df),
            None
        )

        records = df.to_dict(
            orient="records"
        )

        # -----------------------------
        # Store in MongoDB
        # -----------------------------

        inserted_count = insert_dataset(
            collection_name,
            records
        )

        return {
            "message": "Dataset uploaded successfully.",
            "database": DB_NAME,
            "dataset_name": collection_name,
            "dataset_id": get_dataset_id(collection_name),
            "rows": inserted_count,
            "columns": list(df.columns)
        }

    except HTTPException:
        raise
    except Exception as e:

        raise HTTPException(
            status_code=500,
            detail=str(e)
        )


# --------------------------------------------------
# Serve Frontend
# --------------------------------------------------

# Serve frontend static files (CSS, JS)
app.mount(
    "/static",
    StaticFiles(directory="frontend"),
    name="static"
)


# Serve the main HTML page for any non-API route
@app.get("/{full_path:path}")
async def serve_frontend(full_path: str):
    return FileResponse("frontend/index.html")
