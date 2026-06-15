"""
Application-wide settings loaded from environment variables.

Using pydantic-settings gives us:
  - Type-coercion (str → int, etc.) for free
  - A single authoritative source for all tunables
  - Easy override in tests via monkeypatching or a .env.test file
"""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Resolve the .env path relative to THIS file so it is found correctly
# regardless of the working directory from which the server is launched.
_ENV_FILE = Path(__file__).parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # --- Database ---
    # Override with postgresql+psycopg2://... in production / docker
    database_url: str = "sqlite:///./cybernetic.db"

    # --- Redis / Celery ---
    redis_url: str = "redis://localhost:6379/0"

    # --- OpenAI ---
    openai_api_key: str = ""
    openai_model: str = "gpt-4o"

    # --- Orchestration ---
    # Hard ceiling on agent exchanges to prevent runaway loops.
    # Tune upward for complex multi-step research, downward to save tokens.
    max_research_rounds: int = 12

    # --- Tool tunables ---
    # Characters to retain from a fetched page.  4 000 chars ≈ ~1 000 tokens,
    # a safe budget that preserves signal without blowing the context window.
    content_truncation_chars: int = 4_000

    # --- CORS ---
    cors_origins: list[str] = ["http://localhost:3000"]


# Module-level singleton — import `settings` everywhere rather than
# constructing a new Settings() per call.
settings = Settings()
