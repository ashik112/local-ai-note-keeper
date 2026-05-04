import shutil
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import database, jobs, vector_store
from .config import settings


app = FastAPI(title=settings.app_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AskRequest(BaseModel):
    question: str


class NoteUpdate(BaseModel):
    title: str | None = None
    summary: str | None = None
    category: str | None = None
    key_points: list[str] | None = None
    action_items: list[str] | None = None
    entities: list[str] | None = None
    sensitivity: str | None = None


@app.on_event("startup")
async def startup() -> None:
    database.prepare_database()
    jobs.jobs.start()


@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "local_only": settings.local_only,
        "external_access_enabled": settings.external_access_enabled,
        "chat_model": settings.chat_model,
        "embedding_model": settings.embedding_model,
    }


@app.post("/api/notes/audio")
async def create_note_from_audio(file: UploadFile = File(...)) -> dict[str, Any]:
    saved_path = save_upload(file)
    job = await jobs.jobs.add_capture_audio(str(saved_path), saved_path.name)
    return {"job_id": job.id, "state": job.state, "message": job.message}


@app.post("/api/ask/audio")
async def ask_from_audio(file: UploadFile = File(...)) -> dict[str, Any]:
    saved_path = save_upload(file)
    job = await jobs.jobs.add_ask_audio(str(saved_path), saved_path.name)
    return {"job_id": job.id, "state": job.state, "message": job.message}


@app.post("/api/ask")
async def ask_from_text(request: AskRequest) -> dict[str, Any]:
    question = request.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question is required.")
    return await jobs.answer_question(question)


@app.get("/api/jobs/{job_id}")
async def get_job(job_id: str) -> dict[str, Any]:
    job = jobs.jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    return {
        "id": job.id,
        "kind": job.kind,
        "state": job.state,
        "message": job.message,
        "result": job.result,
        "error": job.error,
    }


@app.get("/api/notes")
async def list_notes(category: str | None = None, q: str | None = None, limit: int = 50) -> dict[str, Any]:
    return {"notes": database.list_notes(category=category, query=q, limit=min(limit, 100))}


@app.get("/api/notes/{note_id}")
async def get_note(note_id: str) -> dict[str, Any]:
    note = database.get_note(note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found.")
    return {"note": note}


@app.patch("/api/notes/{note_id}")
async def update_note(note_id: str, request: NoteUpdate) -> dict[str, Any]:
    changes = {key: value for key, value in request.model_dump().items() if value is not None}
    note = database.update_note(note_id, changes)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found.")
    return {"note": note}


@app.delete("/api/notes/{note_id}")
async def delete_note(note_id: str) -> dict[str, Any]:
    note = database.delete_note(note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found.")
    await vector_store.delete_note_vector(note.get("vector_id"))
    return {"deleted": True}


def save_upload(file: UploadFile) -> Path:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Audio file is required.")

    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4()}-{database.safe_filename(file.filename)}"
    path = settings.upload_dir / filename

    with path.open("wb") as output:
        shutil.copyfileobj(file.file, output)

    max_bytes = settings.max_upload_mb * 1024 * 1024
    if path.stat().st_size > max_bytes:
        path.unlink(missing_ok=True)
        raise HTTPException(status_code=413, detail=f"Upload is larger than {settings.max_upload_mb} MB.")

    return path


static_dir = Path(__file__).resolve().parents[2] / "static"
assets_dir = static_dir / "assets"
app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(static_dir / "index.html")
