import os
from pathlib import Path


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

    local_only = os.getenv("LOCAL_ONLY", "true").lower() == "true"
    external_access_enabled = os.getenv("EXTERNAL_ACCESS_ENABLED", "false").lower() == "true"
    hmac_secret = os.getenv("HMAC_SECRET", "")

    max_upload_mb = int(os.getenv("MAX_UPLOAD_MB", "100"))
    collection_name = os.getenv("QDRANT_COLLECTION", "notes")


settings = Settings()
