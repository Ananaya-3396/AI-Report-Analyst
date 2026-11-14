from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    identifier: str = Field(min_length=1, max_length=254, description="Email or phone number.")
    password: str = Field(min_length=1, max_length=128)
    remember: bool = False


class AvailabilityRequest(BaseModel):
    email: str | None = Field(default=None, max_length=254)
    phone: str | None = Field(default=None, max_length=20)
