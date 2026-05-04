from typing import Any

from .config import settings
from .http_client import get_http_client


async def ensure_collection(vector_size: int) -> None:
    # The embedding size comes from the selected Ollama model, so the collection
    # is created after the first embedding instead of hard-coding dimensions.
    client = get_http_client()
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

    client = get_http_client()
    response = await client.put(
        f"{settings.qdrant_url}/collections/{settings.collection_name}/points",
        json=payload,
    )
    response.raise_for_status()


async def search_notes_scored(vector: list[float], limit: int = 12) -> list[tuple[str, float]]:
    """Return note ids sorted by descending vector similarity."""
    await ensure_collection(len(vector))

    client = get_http_client()
    response = await client.post(
        f"{settings.qdrant_url}/collections/{settings.collection_name}/points/search",
        json={"vector": vector, "limit": limit, "with_payload": True},
    )

    if response.status_code == 404:
        return []

    response.raise_for_status()
    result = response.json().get("result", [])
    ranked: list[tuple[str, float]] = []
    seen: set[str] = set()
    for item in result:
        note_id = item.get("payload", {}).get("note_id")
        if not note_id:
            continue
        nid = str(note_id)
        if nid in seen:
            continue
        seen.add(nid)
        score = float(item.get("score", 0))
        ranked.append((nid, score))

    ranked.sort(key=lambda x: x[1], reverse=True)
    return ranked


def narrow_search_results(
    ranked: list[tuple[str, float]], *, max_notes: int = 5, similarity_floor_ratio: float = 0.86
) -> list[str]:
    """Keep top hits that stay close to the best score — drops weak vector matches."""
    if not ranked:
        return []

    top_score = max(ranked[0][1], 1e-9)
    min_score = max(top_score * similarity_floor_ratio, 0.08)
    out: list[str] = []

    for note_id, score in ranked:
        if score < min_score and out:
            break
        if score < min_score and not out:
            out.append(note_id)
            continue
        out.append(note_id)
        if len(out) >= max_notes:
            break

    return out if out else [ranked[0][0]]


async def delete_note_vector(vector_id: str | None) -> None:
    if not vector_id:
        return

    client = get_http_client()
    await client.post(
        f"{settings.qdrant_url}/collections/{settings.collection_name}/points/delete",
        json={"points": [vector_id]},
    )
