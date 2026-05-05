import asyncio
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

from . import ai, database, vector_store


JobState = Literal["queued", "transcribing", "analyzing", "embedding", "stored", "answering", "failed"]


@dataclass
class Job:
    id: str
    kind: str
    state: JobState = "queued"
    message: str = "Queued"
    result: dict[str, Any] | None = None
    error: str | None = None
    payload: dict[str, Any] = field(default_factory=dict)


class JobQueue:
    def __init__(self) -> None:
        self.jobs: dict[str, Job] = {}
        self.queue: asyncio.Queue[str] = asyncio.Queue()
        self.worker_started = False
        self._job_subscribers: defaultdict[str, set[asyncio.Queue[dict[str, Any]]]] = defaultdict(set)

    def snapshot(self, job: Job) -> dict[str, Any]:
        terminal = job.state in ("stored", "failed")
        return {
            "id": job.id,
            "kind": job.kind,
            "state": job.state,
            "message": job.message,
            "result": job.result,
            "error": job.error,
            "terminal": terminal,
        }

    def subscribe_job(self, job_id: str) -> asyncio.Queue[dict[str, Any]]:
        q: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=64)
        self._job_subscribers[job_id].add(q)
        return q

    def unsubscribe_job(self, job_id: str, q: asyncio.Queue[dict[str, Any]]) -> None:
        subs = self._job_subscribers.get(job_id)
        if subs:
            subs.discard(q)
            if not subs:
                del self._job_subscribers[job_id]

    async def broadcast_job(self, job: Job) -> None:
        snap = self.snapshot(job)
        pending = [
            asyncio.create_task(sub.put(dict(snap)))
            for sub in list(self._job_subscribers.get(job.id, set()))
        ]
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)

        if job.state in ("stored", "failed"):
            self._persist_terminal_notification(job)

    async def set_job_progress(
        self, job: Job, state: JobState | None = None, message: str | None = None
    ) -> None:
        if state is not None:
            job.state = state
        if message is not None:
            job.message = message
        await self.broadcast_job(job)

    def _persist_terminal_notification(self, job: Job) -> None:
        try:
            if job.state == "failed":
                database.insert_job_notification(
                    job.id,
                    "failed",
                    "Job failed",
                    job.error or "Unknown error",
                )
                return
            result = job.result or {}
            note = result.get("note")
            if isinstance(note, dict):
                title = str(note.get("title") or "Note saved")
                summary = str(note.get("summary") or "").strip()
                excerpt = summary[:400] + ("…" if len(summary) > 400 else "")
                database.insert_job_notification(job.id, "note_saved", title, excerpt or None)
                return
            answer = result.get("answer")
            if answer:
                question = str(result.get("question") or "").strip()
                excerpt = str(answer).strip()
                excerpt = excerpt[:400] + ("…" if len(excerpt) > 400 else "")
                line = (
                    (f"{question}: {excerpt}" if question else excerpt) if excerpt else None
                )
                database.insert_job_notification(job.id, "answer_ready", "Answer ready", line)
        except Exception:
            # Persistence must never break the worker path
            return

    def start(self) -> None:
        if not self.worker_started:
            self.worker_started = True
            asyncio.create_task(self._worker())

    async def add_capture_audio(self, path: str, filename: str, browser_transcript: str = "") -> Job:
        job = Job(
            id=str(uuid.uuid4()),
            kind="capture_audio",
            payload={"path": path, "filename": filename, "browser_transcript": browser_transcript},
        )
        self.jobs[job.id] = job
        await self.queue.put(job.id)
        await self.broadcast_job(job)
        return job

    async def add_ask_audio(self, path: str, filename: str, browser_transcript: str = "") -> Job:
        job = Job(
            id=str(uuid.uuid4()),
            kind="ask_audio",
            payload={"path": path, "filename": filename, "browser_transcript": browser_transcript},
        )
        self.jobs[job.id] = job
        await self.queue.put(job.id)
        await self.broadcast_job(job)
        return job

    async def add_capture_text(self, transcript: str) -> Job:
        job = Job(id=str(uuid.uuid4()), kind="capture_text", payload={"transcript": transcript})
        self.jobs[job.id] = job
        await self.queue.put(job.id)
        await self.broadcast_job(job)
        return job

    def get(self, job_id: str) -> Job | None:
        return self.jobs.get(job_id)

    async def _worker(self) -> None:
        while True:
            job_id = await self.queue.get()
            job = self.jobs[job_id]
            try:
                if job.kind == "capture_audio":
                    await self._process_capture_audio(job)
                elif job.kind == "capture_text":
                    await self._process_capture_text(job)
                elif job.kind == "ask_audio":
                    await self._process_ask_audio(job)
            except Exception as exc:
                job.state = "failed"
                job.message = "Failed"
                job.error = str(exc)
                await self.broadcast_job(job)
            finally:
                self.queue.task_done()

    async def _process_capture_audio(self, job: Job) -> None:
        path = Path(job.payload["path"])
        try:
            await self._process_capture_audio_file(job, path)
        finally:
            path.unlink(missing_ok=True)

    async def _process_capture_audio_file(self, job: Job, path: Path) -> None:
        browser_hint = str(job.payload.get("browser_transcript") or "").strip()

        if len(browser_hint) >= 12:
            transcript = browser_hint
        else:
            await self.set_job_progress(job, "transcribing", "Transcribing audio")
            whisper_text = await ai.transcribe_audio(str(path), job.payload["filename"])
            if not whisper_text:
                raise ValueError("Whisper returned an empty transcript.")
            transcript = whisper_text

        await self._analyze_and_store_note(job, transcript, audio_filename=job.payload["filename"])

    async def _process_capture_text(self, job: Job) -> None:
        transcript = str(job.payload["transcript"]).strip()
        if not transcript:
            raise ValueError("Transcript is required.")
        await self._analyze_and_store_note(job, transcript, audio_filename=None)

    async def _process_ask_audio(self, job: Job) -> None:
        path = Path(job.payload["path"])
        try:
            await self._process_ask_audio_file(job, path)
        finally:
            path.unlink(missing_ok=True)

    async def _process_ask_audio_file(self, job: Job, path: Path) -> None:
        browser_hint = str(job.payload.get("browser_transcript") or "").strip()

        if len(browser_hint) >= 8:
            question = browser_hint
        else:
            await self.set_job_progress(job, "transcribing", "Transcribing question")
            whisper_q = await ai.transcribe_audio(str(path), job.payload["filename"])
            if not whisper_q:
                raise ValueError("Whisper returned an empty question.")
            question = whisper_q

        await self.set_job_progress(job, "answering", "Searching memory")
        result = await answer_question(question)
        job.state = "stored"
        job.message = "Answered"
        job.result = result
        await self.broadcast_job(job)

    async def _analyze_and_store_note(self, job: Job, transcript: str, audio_filename: str | None) -> None:
        await self.set_job_progress(job, "analyzing", "Creating note")
        details = await ai.analyze_note(transcript)

        await self.set_job_progress(job, "embedding", "Saving memory")
        note_id = str(uuid.uuid4())
        vector_id = str(uuid.uuid4())
        note = {
            "id": note_id,
            "title": details["title"],
            "transcript": transcript,
            "summary": details["summary"],
            "category": details["category"],
            "key_points": details["key_points"],
            "action_items": details["action_items"],
            "entities": details["entities"],
            "sensitivity": details["sensitivity"],
            "audio_filename": audio_filename,
            "vector_id": vector_id,
        }
        database.save_note(note)
        saved_note = database.get_note(note_id)
        if not saved_note:
            raise ValueError("Note was not saved.")

        vector_text = build_vector_text(saved_note)
        vector = await ai.embed_text(vector_text)
        await vector_store.upsert_note_vector(saved_note, vector)

        job.state = "stored"
        job.message = "Saved"
        job.result = {"note": saved_note}
        await self.broadcast_job(job)


async def answer_question(question: str) -> dict[str, Any]:
    vector = await ai.embed_text(question)
    ranked = await vector_store.search_notes_scored(vector, limit=12)
    note_ids = vector_store.narrow_search_results(ranked, max_notes=5)
    notes = database.get_notes_by_ids(note_ids)
    answer, source_indices = await ai.answer_question_from_notes(question, notes)
    cited: list[dict[str, Any]] = []
    for idx in source_indices:
        if 1 <= idx <= len(notes):
            cited.append(notes[idx - 1])

    dedup_seen: set[str] = set()
    sources: list[dict[str, Any]] = []
    for note in cited:
        nid = str(note["id"])
        if nid not in dedup_seen:
            dedup_seen.add(nid)
            sources.append(note)

    question_id = str(uuid.uuid4())
    database.save_question(question_id, question, answer, [note["id"] for note in sources])
    return {"question": question, "answer": answer, "sources": sources}


def build_vector_text(note: dict[str, Any]) -> str:
    return "\n".join(
        [
            note["title"],
            note["summary"],
            "Key points: " + "; ".join(note.get("key_points", [])),
            "Action items: " + "; ".join(note.get("action_items", [])),
            "Entities: " + "; ".join(note.get("entities", [])),
            "Transcript: " + note["transcript"][:2000],
        ]
    )


jobs = JobQueue()
