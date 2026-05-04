import asyncio
import uuid
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
        return job

    async def add_ask_audio(self, path: str, filename: str, browser_transcript: str = "") -> Job:
        job = Job(
            id=str(uuid.uuid4()),
            kind="ask_audio",
            payload={"path": path, "filename": filename, "browser_transcript": browser_transcript},
        )
        self.jobs[job.id] = job
        await self.queue.put(job.id)
        return job

    async def add_capture_text(self, transcript: str) -> Job:
        job = Job(id=str(uuid.uuid4()), kind="capture_text", payload={"transcript": transcript})
        self.jobs[job.id] = job
        await self.queue.put(job.id)
        return job

    def get(self, job_id: str) -> Job | None:
        return self.jobs.get(job_id)

    async def _worker(self) -> None:
        # One worker is intentional for v1. It prevents Whisper and the LLM from
        # competing for laptop resources across several recordings at once.
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
            job.state = "transcribing"
            job.message = "Transcribing audio"
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
            job.state = "transcribing"
            job.message = "Transcribing question"
            whisper_q = await ai.transcribe_audio(str(path), job.payload["filename"])
            if not whisper_q:
                raise ValueError("Whisper returned an empty question.")
            question = whisper_q

        job.state = "answering"
        job.message = "Searching memory"
        result = await answer_question(question)
        job.state = "stored"
        job.message = "Answered"
        job.result = result

    async def _analyze_and_store_note(self, job: Job, transcript: str, audio_filename: str | None) -> None:
        job.state = "analyzing"
        job.message = "Creating note"
        details = await ai.analyze_note(transcript)

        job.state = "embedding"
        job.message = "Saving memory"
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
