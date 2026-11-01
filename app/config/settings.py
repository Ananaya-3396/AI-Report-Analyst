from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):

    app_name: str = "Data Analysis Bot"
    app_env: str = "development"
    debug: bool = False

    host: str = "0.0.0.0"
    port: int = 8000

    mongo_uri: str
    mongo_database: str = Field(validation_alias="MONGO_DB_NAME")

    jwt_secret_key: str
    jwt_access_token_expire_minutes: int = 30

    llm_api_key: str
    llm_model: str

    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore"
    )


settings = Settings()
