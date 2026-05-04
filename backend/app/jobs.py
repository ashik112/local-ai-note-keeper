import asyncio
import uuid
from dataclasses import dataclass, field
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

    async def add_capture_audio(self, path: str, filename: str) -> Job:
        job = Job(id=str(uuid.uuid4()), kind="capture_audio", payload={"path": path, "filename": filename})
        self.jobs[job.id] = job
        await self.queue.put(job.id)
        return job

    async def add_ask_audio(self, path: str, filename: str) -> Job:
        job = Job(id=str(uuid.uuid4()), kind="ask_audio", payload={"path": path, "filename": filename})
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
                elif job.kind == "ask_audio":
                    await self._process_ask_audio(job)
            except Exception as exc:
                job.state = "failed"
                job.message = "Failed"
                job.error = str(exc)
            finally:
                self.queue.task_done()

    async def _process_capture_audio(self, job: Job) -> None:
        job.state = "transcribing"
        job.message = "Transcribing audio"
        transcript = await ai.transcribe_audio(job.payload["path"], job.payload["filename"])
        if not transcript:
            raise ValueError("Whisper returned an empty transcript.")

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
            "audio_filename": job.payload["filename"],
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

    async def _process_ask_audio(self, job: Job) -> None:
        job.state = "transcribing"
        job.message = "Transcribing question"
        question = await ai.transcribe_audio(job.payload["path"], job.payload["filename"])
        if not question:
            raise ValueError("Whisper returned an empty question.")

        job.state = "answering"
        job.message = "Searching memory"
        result = await answer_question(question)
        job.state = "stored"
        job.message = "Answered"
        job.result = result


async def answer_question(question: str) -> dict[str, Any]:
    vector = await ai.embed_text(question)
    note_ids = await vector_store.search_notes(vector)
    notes = database.get_notes_by_ids(note_ids)
    answer = await ai.answer_question(question, notes)
    question_id = str(uuid.uuid4())
    database.save_question(question_id, question, answer, [note["id"] for note in notes])
    return {"question": question, "answer": answer, "sources": notes}


def build_vector_text(note: dict[str, Any]) -> str:
    return "\n".join(
        [
            note["title"],
            note["summary"],
            "Key points: " + "; ".join(note.get("key_points", [])),
            "Entities: " + "; ".join(note.get("entities", [])),
            "Transcript: " + note["transcript"][:2000],
        ]
    )


jobs = JobQueue()
