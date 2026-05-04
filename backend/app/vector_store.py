from typing import Any

import httpx

from .config import settings


async def ensure_collection(vector_size: int) -> None:
    # The embedding size comes from the selected Ollama model, so the collection
    # is created after the first embedding instead of hard-coding dimensions.
    async with httpx.AsyncClient(timeout=60) as client:
        existing = await client.get(f"{settings.qdrant_url}/collections/{settings.collection_name}")
        if existing.status_code == 200:
            return

        response = await client.put(
            f"{settings.qdrant_url}/collections/{settings.collection_name}",
            json={"vectors": {"size": vector_size, "distance": "Cosine"}},
        )
        response.raise_for_status()


async def upsert_note_vector(note: dict[str, Any], vector: list[float]) -> None:
    await ensure_collection(len(vector))

    payload = {
        "points": [
            {
                "id": note["vector_id"],
                "vector": vector,
                "payload": {
                    "note_id": note["id"],
                    "title": note["title"],
                    "category": note["category"],
                    "summary": note["summary"],
                    "created_at": note["created_at"],
                    "entities": note.get("entities", []),
                    "sensitivity": note["sensitivity"],
                },
            }
        ]
    }

    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.put(
            f"{settings.qdrant_url}/collections/{settings.collection_name}/points",
            json=payload,
        )
        response.raise_for_status()


async def search_notes(vector: list[float], limit: int = 6) -> list[str]:
    await ensure_collection(len(vector))

    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(
            f"{settings.qdrant_url}/collections/{settings.collection_name}/points/search",
            json={"vector": vector, "limit": limit, "with_payload": True},
        )

    if response.status_code == 404:
        return []

    response.raise_for_status()
    result = response.json().get("result", [])
    note_ids: list[str] = []
    for item in result:
        note_id = item.get("payload", {}).get("note_id")
        if note_id:
            note_ids.append(str(note_id))
    return note_ids


async def delete_note_vector(vector_id: str | None) -> None:
    if not vector_id:
        return

    async with httpx.AsyncClient(timeout=60) as client:
        await client.post(
            f"{settings.qdrant_url}/collections/{settings.collection_name}/points/delete",
            json={"points": [vector_id]},
        )
