import os
import re
from pathlib import Path


def _csv_list(raw: str) -> list[str]:
    return [x.strip() for x in raw.split(",") if x.strip()]


def _optional_truthy(env_name: str) -> bool | None:
    """If the env var is unset or blank, return None; otherwise parse true/false."""
    raw = os.getenv(env_name)
    if raw is None or not raw.strip():
        return None
    return raw.strip().lower() in ("1", "true", "yes", "on")


class Settings:
    app_name = "Private AI Note Keeper"
    data_dir = Path(os.getenv("DATA_DIR", "/app/data"))
    upload_dir = Path(os.getenv("UPLOAD_DIR", "/app/uploads"))
    database_path = data_dir / "notes.sqlite3"

    ollama_url = os.getenv("OLLAMA_URL", "http://ollama:11434")
    qdrant_url = os.getenv("QDRANT_URL", "http://qdrant:6333")
    whisper_url = os.getenv("WHISPER_URL", "http://whisper:8080")

    chat_model = os.getenv("CHAT_MODEL", "gemma2:2b")
    embedding_model = os.getenv("EMBEDDING_MODEL", "nomic-embed-text")
    ollama_keep_alive = os.getenv("OLLAMA_KEEP_ALIVE", "1m")

    hmac_secret = os.getenv("HMAC_SECRET", "")

    max_upload_mb = int(os.getenv("MAX_UPLOAD_MB", "100"))
    collection_name = os.getenv("QDRANT_COLLECTION", "notes")

    # Host-published port (for CORS defaults). In Docker, set via compose PUBLIC_APP_PORT.
    public_app_port = int(os.getenv("PUBLIC_APP_PORT", "8743"))

    # CORS only: RFC1918 browser origins when the UI does not match allow_origins (rare).
    _cors_lan_explicit = _optional_truthy("CORS_LAN_ORIGINS")
    _cors_lan_legacy = _optional_truthy("EXTERNAL_ACCESS_ENABLED")
    cors_lan_origins = (
        _cors_lan_explicit
        if _cors_lan_explicit is not None
        else (_cors_lan_legacy if _cors_lan_legacy is not None else False)
    )

    _cors_env = os.getenv("CORS_ORIGINS", "").strip()
    if _cors_env:
        cors_origins = _csv_list(_cors_env)
    else:
        p = public_app_port
        cors_origins = [
            f"http://localhost:{p}",
            f"http://127.0.0.1:{p}",
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        ]

    _cors_regex_env = os.getenv("CORS_ORIGIN_REGEX", "").strip()
    if _cors_regex_env:
        cors_origin_regex: str | None = _cors_regex_env
        try:
            re.compile(cors_origin_regex)
        except re.error:
            cors_origin_regex = None
    elif cors_lan_origins:
        p = public_app_port
        cors_origin_regex = (
            rf"^http://(192\.168\.\d{{1,3}}\.\d{{1,3}}"
            rf"|10\.\d{{1,3}}\.\d{{1,3}}\.\d{{1,3}}"
            rf"|172\.(1[6-9]|2[0-9]|3[0-1])\.\d{{1,3}}\.\d{{1,3}}):{p}$"
        )
    else:
        cors_origin_regex = None


settings = Settings()
