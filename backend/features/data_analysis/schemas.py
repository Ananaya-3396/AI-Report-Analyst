from typing import Literal

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=20)
    selected_dataset: str | None = Field(default=None, max_length=120)
    replaces_id: str | None = Field(default=None, max_length=24)
    chat_id: str = Field(min_length=1, max_length=64)


class SavedNote(BaseModel):
    content: str = Field(min_length=1, max_length=4000)
    chat_id: str = Field(min_length=1, max_length=64)


class SelectedDatasetUpdate(BaseModel):
    selected_dataset: str | None = Field(default=None, max_length=120)


class ChatResponse(BaseModel):
    reply: str
    cells: list[dict] = []
    turn_id: str | None = None
