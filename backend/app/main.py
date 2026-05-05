import uuid
import shutil
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import database, jobs, vector_store
from .config import settings
from .http_client import close_http_client


@asynccontextmanager
async def lifespan(app: FastAPI):
    database.prepare_database()
    jobs.jobs.start()
    yield
    await close_http_client()


app = FastAPI(title=settings.app_name, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AskRequest(BaseModel):
    question: str


class TextNoteRequest(BaseModel):
    transcript: str


class NoteUpdate(BaseModel):
    title: str | None = None
    summary: str | None = None
    category: str | None = None
    key_points: list[str] | None = None
    action_items: list[str] | None = None
    entities: list[str] | None = None
    sensitivity: str | None = None


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
async def create_note_from_audio(
    file: UploadFile = File(...),
    browser_transcript: str = Form(default=""),
) -> dict[str, Any]:
    saved_path = save_upload(file)
    job = await jobs.jobs.add_capture_audio(str(saved_path), saved_path.name, browser_transcript.strip())
    return {"job_id": job.id, "state": job.state, "message": job.message}


@app.post("/api/notes/text")
async def create_note_from_text(request: TextNoteRequest) -> dict[str, Any]:
    transcript = request.transcript.strip()
    if not transcript:
        raise HTTPException(status_code=400, detail="Transcript is required.")
    job = await jobs.jobs.add_capture_text(transcript)
    return {"job_id": job.id, "state": job.state, "message": job.message}


@app.post("/api/ask/audio")
async def ask_from_audio(
    file: UploadFile = File(...),
    browser_transcript: str = Form(default=""),
) -> dict[str, Any]:
    saved_path = save_upload(file)
    job = await jobs.jobs.add_ask_audio(str(saved_path), saved_path.name, browser_transcript.strip())
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
    return jobs.jobs.snapshot(job)


@app.websocket("/api/jobs/{job_id}/watch")
async def watch_job_socket(ws: WebSocket, job_id: str) -> None:
    await ws.accept()
    job = jobs.jobs.get(job_id)
    if job is None:
        await ws.close(code=4404)
        return
    q = jobs.jobs.subscribe_job(job_id)
    try:
        await ws.send_json(jobs.jobs.snapshot(job))
        while True:
            payload = await q.get()
            await ws.send_json(payload)
            if payload.get("terminal"):
                break
    except WebSocketDisconnect:
        pass
    finally:
        jobs.jobs.unsubscribe_job(job_id, q)


@app.get("/api/notifications")
async def list_notifications_route(unread_only: bool = False, limit: int = 30) -> dict[str, Any]:
    capped = max(1, min(limit, 100))
    return {
        "notifications": database.list_notifications(limit=capped, unread_only=unread_only),
        "unread_count": database.unread_notification_count(),
    }


@app.post("/api/notifications/read-all")
async def notifications_read_all() -> dict[str, bool]:
    database.mark_all_notifications_read()
    return {"ok": True}


@app.post("/api/notifications/{notification_id}/read")
async def notification_read(notification_id: str) -> dict[str, bool]:
    if not database.mark_notification_read(notification_id):
        raise HTTPException(status_code=404, detail="Notification not found.")
    return {"ok": True}


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
if assets_dir.is_dir():
    app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(static_dir / "index.html")
