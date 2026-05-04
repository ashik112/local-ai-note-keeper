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
You turn private voice transcripts into structured notes.

Return only valid JSON with exactly these keys (lists may be empty arrays []):
title: short human title
summary: 1-3 clear sentences
category: one of Personal, Work, Project, Task, Credential or ID, Meeting, Journal, Idea, Finance, Other
  Choose using these definitions (pick the single best fit):
  - Task: a concrete one-off or short errand — buy/book/call/schedule/pay/renew/submit; a single reminder or deadline
    for one action. Travel bookings and ticket purchases are Task (or Personal), never Project.
  - Project: sustained multi-step work over time with several moving parts (e.g. product launch, migration, major build,
    phased initiative). Not a single purchase or trip prep item.
  - Personal: private life context (family, health, social, travel plans) when it is not clearly Work and not better as Task.
  - Work: job, employer, colleagues, workplace deliverables.
  - Meeting: about a specific meeting or call.
  - Journal: reflective or emotional diary-style content, not task lists.
  - Idea: brainstorm or concept without concrete next steps yet.
  - Finance: money, banking, bills, budgets, investments, taxes.
  - Credential or ID: secrets, logins, IDs, account numbers, codes.
  - Other: none of the above fit.
key_points: array of factual takeaways only (who/what/when/why). Not commands.
action_items: array of implied or stated next steps — reminders, todos, follow-ups, errands, calls,
  deadlines, purchases, meetings to schedule. Each item must be a short verb-led phrase in first or neutral imperatives
  (examples: "Buy milk on the way home", "Email Sarah about the contract", "Renew passport before July").
  Include items even if soft ("might want to check…") when they clearly suggest doing something later.
  Use [] only when the transcript is purely descriptive or reflective with zero actionable implications.
entities: array of people, organizations, places, IDs, or account names mentioned (field name is unrelated to category Project)
sensitivity: one of normal, private, sensitive

Rules:
- Do not put the same text in both key_points and action_items.
- Prefer splitting mixed sentences: fact → key_points, duty → action_items.
- Prefer Task over Project when the gist is one errand, purchase, reservation, ticket, appointment, or single deadline.
- Keep place names, people, and proper nouns spelled as in the transcript; do not substitute homophones or joke names.

Transcript:
{transcript}
""".strip()

    data = await chat_json(prompt)
    return {
        "title": str(data.get("title") or "Untitled note").strip()[:120],
        "summary": str(data.get("summary") or transcript[:500]).strip(),
        "category": normalize_category(data.get("category")),
        "key_points": clean_string_list(data.get("key_points")),
        "action_items": extract_action_items(data),
        "entities": clean_string_list(data.get("entities")),
        "sensitivity": normalize_sensitivity(data.get("sensitivity")),
    }


_NOTE_CONTEXT_CHARS = 720


async def answer_question_from_notes(question: str, notes: list[dict[str, Any]]) -> tuple[str, list[int]]:
    """Produce an answer and 1-based note indices actually used."""
    if not notes:
        answer = (
            "No memories matched closely enough yet. Capture a relevant note first, or try rewording."
        ).strip()
        return answer, []

    context_parts: list[str] = []
    for index, note in enumerate(notes):
        excerpt = str(note["transcript"] or "")[:_NOTE_CONTEXT_CHARS]
        context_parts.append(
            f"Note {index + 1} (id: {note['id']}):\n"
            f"Title: {note['title']}\n"
            f"Category: {note['category']}\n"
            f"Created: {note['created_at']}\n"
            f"Summary: {note['summary']}\n"
            f"Key points: {', '.join(note['key_points'])}\n"
            f"Action items: {', '.join(note.get('action_items', []))}\n"
            f"Transcript excerpt:\n{excerpt}"
        )
    context = "\n\n".join(context_parts)

    prompt = f"""
You answer questions using ONLY the numbered notes below.
Return ONLY valid JSON with exactly two keys:
- answer: concise practical answer grounded in those notes only
- source_indices: array of 1-based note numbers from this list — include only notes you actually used as evidence.
  Omit unrelated or weak hits. Prefer 1–3 sources; use empty [] only when no note supports your answer.

If nothing in the notes answers the question, set answer to a brief "no matching memory" style message (do not hallucinate facts) and source_indices to [].

Question:
{question}

Stored notes:
{context}
""".strip()

    data = await chat_json(prompt)
    answer = str(data.get("answer") or "").strip()

    indices = _sanitize_source_indices(data.get("source_indices"), len(notes))

    deduped: list[int] = []
    for i in indices:
        if i not in deduped:
            deduped.append(i)
    indices = deduped

    return answer, indices


def _sanitize_source_indices(raw: Any, num_notes: int) -> list[int]:
    out: list[int] = []
    if not isinstance(raw, list):
        return out

    for item in raw:
        try:
            i = int(item)
        except (TypeError, ValueError):
            continue
        if 1 <= i <= num_notes:
            out.append(i)
    return out


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


_ACTION_ITEM_KEYS = (
    "action_items",
    "action_paths",
    "action_items_paths",
    "tasks",
    "todos",
    "todo_items",
    "next_steps",
    "follow_ups",
    "followups",
    "commitments",
)


def extract_action_items(data: dict[str, Any]) -> list[str]:
    """Models often omit action_items or use alternate keys / a single string."""
    chunks: list[str] = []
    for key in _ACTION_ITEM_KEYS:
        chunks.extend(coerce_listish(data.get(key)))

    merged = dedupe_preserve_order(chunks)

    # If model stuffed tasks into key_points as imperative lines, recover obvious ones (optional thin heuristic).
    if not merged:
        merged = infer_actions_from_key_points(data.get("key_points"))

    return merged


def coerce_listish(value: Any) -> list[str]:
    if isinstance(value, list):
        return clean_string_list(value)
    if isinstance(value, str):
        return split_bullet_lines(value)
    return []


def split_bullet_lines(text: str) -> list[str]:
    raw = text.strip()
    if not raw:
        return []
    lines: list[str] = []
    for part in raw.replace(";", "\n").split("\n"):
        line = part.strip()
        if not line:
            continue
        line = line.lstrip("•*-–").strip()
        if len(line) > 2 and line[0].isdigit() and line[1] in ".): ":
            line = line.lstrip("0123456789").lstrip(".): ").strip()
        if line:
            lines.append(line)
    return lines


def dedupe_preserve_order(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        key = item.casefold()
        if key not in seen:
            seen.add(key)
            out.append(item)
    return out


def infer_actions_from_key_points(value: Any) -> list[str]:
    """Last resort when the model leaves action_items empty but puts todos into key_points."""
    if not isinstance(value, list):
        return []
    action_like_prefixes = (
        "need to ",
        "must ",
        "should ",
        "remember to ",
        "don't forget ",
        "schedule ",
        "call ",
        "email ",
        "send ",
        "buy ",
        "pay ",
        "book ",
        "follow up ",
        "follow-up ",
        "pick up ",
        "pickup ",
        "renew ",
        "submit ",
        "apply ",
        "check ",
        "verify ",
        "order ",
        "return ",
        "visit ",
        "meet ",
        "remind ",
    )
    out: list[str] = []
    for item in value:
        s = str(item).strip()
        if not s:
            continue
        low = s.casefold()
        if low.startswith(action_like_prefixes):
            out.append(s)
    return dedupe_preserve_order(out)


def normalize_sensitivity(value: str | None) -> str:
    if value in {"normal", "private", "sensitive"}:
        return value
    return "normal"
