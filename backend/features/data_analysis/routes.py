import asyncio
import logging

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException

from backend.controllers.data_analysis import (
    clear_history,
    get_dataset_schema,
    load_history,
    load_chat,
    profile_dataset,
    save_note,
    save_selected_dataset,
    save_turn,
)
from backend.controllers.data_handling import get_dataset_id
from backend.core.security import current_user
from backend.features.data_analysis.schemas import (
    ChatRequest,
    ChatResponse,
    SavedNote,
    SelectedDatasetUpdate,
)
from backend.tool_calling.llm import (
    LLMConfigurationError,
    LLMProviderError,
    generate_dataset_overview,
    generate_reply,
)
from backend.tool_calling.tools import run_code


logger = logging.getLogger(__name__)

router = APIRouter(tags=["data analysis"], dependencies=[Depends(current_user)])


@router.post("/api/chat", response_model=ChatResponse)
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
                request.chat_id,
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

@router.get("/api/chat/history")
def get_chat_history():
    return load_history()


@router.get("/api/chat/history/{chat_id}")
def get_chat(chat_id: str):
    return load_chat(chat_id)


@router.post("/api/chat/notes", status_code=201)
def add_chat_note(note: SavedNote):
    return {"id": save_note(note.content, note.chat_id)}


@router.put("/api/chat/selected-dataset")
def update_selected_dataset(update: SelectedDatasetUpdate):
    save_selected_dataset(update.selected_dataset)
    return {"saved": True}


@router.delete("/api/chat/history")
def delete_chat_history():
    clear_history()
    return {"cleared": True}


# --------------------------------------------------
# Profiling (EDA)
# --------------------------------------------------

@router.post("/api/datasets/{dataset_name}/profile")
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
