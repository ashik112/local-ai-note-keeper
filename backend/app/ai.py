import json
from typing import Any

import httpx

from .config import settings


CATEGORIES = {
    "Personal",
    "Work",
    "Project",
    "Task",
    "Credential or ID",
    "Meeting",
    "Journal",
    "Idea",
    "Finance",
    "Other",
}


def normalize_category(value: str | None) -> str:
    if not value:
        return "Other"

    cleaned = value.strip()
    for category in CATEGORIES:
        if cleaned.lower() == category.lower():
            return category
    return "Other"


async def transcribe_audio(path: str, filename: str) -> str:
    async with httpx.AsyncClient(timeout=600) as client:
        with open(path, "rb") as audio_file:
            response = await client.post(
                f"{settings.whisper_url}/inference",
                files={"file": (filename, audio_file, "application/octet-stream")},
                data={
                    "temperature": "0.0",
                    "temperature_inc": "0.2",
                    "response_format": "json",
                },
            )
        response.raise_for_status()

    payload = response.json()
    return str(payload.get("text", "")).strip()


async def analyze_note(transcript: str) -> dict[str, Any]:
    prompt = f"""
You turn private voice transcripts into clean notes.

Return only valid JSON with these keys:
title: short human title
summary: 1-3 clear sentences
category: one of Personal, Work, Project, Task, Credential or ID, Meeting, Journal, Idea, Finance, Other
key_points: short array of important facts
action_items: short array of tasks, empty if none
entities: short array of people, projects, places, IDs, or account names
sensitivity: one of normal, private, sensitive

Transcript:
{transcript}
""".strip()

    data = await chat_json(prompt)
    return {
        "title": str(data.get("title") or "Untitled note").strip()[:120],
        "summary": str(data.get("summary") or transcript[:500]).strip(),
        "category": normalize_category(data.get("category")),
        "key_points": clean_string_list(data.get("key_points")),
        "action_items": clean_string_list(data.get("action_items")),
        "entities": clean_string_list(data.get("entities")),
        "sensitivity": normalize_sensitivity(data.get("sensitivity")),
    }


async def answer_question(question: str, notes: list[dict[str, Any]]) -> str:
    context = "\n\n".join(
        f"Note {index + 1}: {note['title']}\n"
        f"Category: {note['category']}\n"
        f"Created: {note['created_at']}\n"
        f"Summary: {note['summary']}\n"
        f"Key points: {', '.join(note['key_points'])}\n"
        f"Transcript excerpt: {note['transcript'][:1200]}"
        for index, note in enumerate(notes)
    )

    prompt = f"""
Answer the user's question using only the stored notes below.
If the notes do not contain the answer, say that no matching memory was found.
Keep the answer concise and practical.

Question:
{question}

Stored notes:
{context or "No stored notes were found."}
""".strip()

    return await chat_text(prompt)


async def chat_json(prompt: str) -> dict[str, Any]:
    text = await chat_text(prompt, json_mode=True)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            return json.loads(text[start : end + 1])
        raise ValueError(f"Model did not return JSON: {text[:300]}")


async def chat_text(prompt: str, json_mode: bool = False) -> str:
    payload: dict[str, Any] = {
        "model": settings.chat_model,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
        "keep_alive": settings.ollama_keep_alive,
    }
    if json_mode:
        payload["format"] = "json"

    async with httpx.AsyncClient(timeout=600) as client:
        response = await client.post(f"{settings.ollama_url}/api/chat", json=payload)
        response.raise_for_status()

    data = response.json()
    return str(data.get("message", {}).get("content", "")).strip()


async def embed_text(text: str) -> list[float]:
    async with httpx.AsyncClient(timeout=120) as client:
        response = await client.post(
            f"{settings.ollama_url}/api/embeddings",
            json={"model": settings.embedding_model, "prompt": text},
        )
        response.raise_for_status()

    data = response.json()
    embedding = data.get("embedding")
    if not isinstance(embedding, list):
        raise ValueError("Ollama did not return an embedding.")
    return [float(value) for value in embedding]


def clean_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def normalize_sensitivity(value: str | None) -> str:
    if value in {"normal", "private", "sensitive"}:
        return value
    return "normal"
