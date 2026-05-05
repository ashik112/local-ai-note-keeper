import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import settings


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def prepare_database() -> None:
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    settings.upload_dir.mkdir(parents=True, exist_ok=True)

    with connect() as db:
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS notes (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                transcript TEXT NOT NULL,
                summary TEXT NOT NULL,
                category TEXT NOT NULL,
                key_points_json TEXT NOT NULL,
                action_items_json TEXT NOT NULL,
                entities_json TEXT NOT NULL,
                sensitivity TEXT NOT NULL,
                audio_filename TEXT,
                vector_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS ask_history (
                id TEXT PRIMARY KEY,
                question TEXT NOT NULL,
                answer TEXT NOT NULL,
                source_note_ids_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS notifications (
                id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL UNIQUE,
                kind TEXT NOT NULL,
                title TEXT NOT NULL,
                body TEXT,
                read INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            )
            """
        )
        db.commit()


@contextmanager
def connect():
    db = sqlite3.connect(settings.database_path)
    db.row_factory = sqlite3.Row
    try:
        yield db
    finally:
        db.close()


def to_json(value: Any) -> str:
    return json.dumps(value or [], ensure_ascii=False)


def from_json(value: str) -> Any:
    if not value:
        return []
    return json.loads(value)


def row_to_note(row: sqlite3.Row) -> dict[str, Any]:
    note = dict(row)
    note["key_points"] = from_json(note.pop("key_points_json"))
    note["action_items"] = from_json(note.pop("action_items_json"))
    note["entities"] = from_json(note.pop("entities_json"))
    return note


def save_note(note: dict[str, Any]) -> None:
    timestamp = now_iso()
    with connect() as db:
        db.execute(
            """
            INSERT INTO notes (
                id, title, transcript, summary, category, key_points_json,
                action_items_json, entities_json, sensitivity, audio_filename,
                vector_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                note["id"],
                note["title"],
                note["transcript"],
                note["summary"],
                note["category"],
                to_json(note.get("key_points")),
                to_json(note.get("action_items")),
                to_json(note.get("entities")),
                note["sensitivity"],
                note.get("audio_filename"),
                note.get("vector_id"),
                timestamp,
                timestamp,
            ),
        )
        db.commit()


def list_notes(category: str | None = None, query: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
    sql = "SELECT * FROM notes"
    params: list[Any] = []
    filters: list[str] = []

    if category:
        filters.append("category = ?")
        params.append(category)

    if query:
        filters.append("(title LIKE ? OR transcript LIKE ? OR summary LIKE ?)")
        needle = f"%{query}%"
        params.extend([needle, needle, needle])

    if filters:
        sql += " WHERE " + " AND ".join(filters)

    sql += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)

    with connect() as db:
        rows = db.execute(sql, params).fetchall()
        return [row_to_note(row) for row in rows]


def get_note(note_id: str) -> dict[str, Any] | None:
    with connect() as db:
        row = db.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
        return row_to_note(row) if row else None


def get_notes_by_ids(note_ids: list[str]) -> list[dict[str, Any]]:
    if not note_ids:
        return []

    order = {nid: i for i, nid in enumerate(note_ids)}
    placeholders = ",".join("?" for _ in note_ids)
    with connect() as db:
        rows = db.execute(f"SELECT * FROM notes WHERE id IN ({placeholders})", note_ids).fetchall()
        notes = [row_to_note(row) for row in rows]
        return sorted(notes, key=lambda note: order.get(note["id"], len(note_ids)))


def update_note(note_id: str, changes: dict[str, Any]) -> dict[str, Any] | None:
    allowed = {"title", "summary", "category", "sensitivity"}
    fields = [key for key in changes if key in allowed]

    json_fields = {
        "key_points": "key_points_json",
        "action_items": "action_items_json",
        "entities": "entities_json",
    }
    fields.extend([key for key in changes if key in json_fields])

    if not fields:
        return get_note(note_id)

    assignments = []
    params: list[Any] = []
    for field in fields:
        if field in json_fields:
            assignments.append(f"{json_fields[field]} = ?")
            params.append(to_json(changes[field]))
        else:
            assignments.append(f"{field} = ?")
            params.append(changes[field])

    assignments.append("updated_at = ?")
    params.append(now_iso())
    params.append(note_id)

    with connect() as db:
        db.execute(f"UPDATE notes SET {', '.join(assignments)} WHERE id = ?", params)
        db.commit()

    return get_note(note_id)


def delete_note(note_id: str) -> dict[str, Any] | None:
    note = get_note(note_id)
    if not note:
        return None
    with connect() as db:
        db.execute("DELETE FROM notes WHERE id = ?", (note_id,))
        db.commit()
    return note


def save_question(question_id: str, question: str, answer: str, source_note_ids: list[str]) -> None:
    with connect() as db:
        db.execute(
            """
            INSERT INTO ask_history (id, question, answer, source_note_ids_json, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (question_id, question, answer, to_json(source_note_ids), now_iso()),
        )
        db.commit()


def insert_job_notification(job_id_str: str, kind: str, title: str, body: str | None) -> str | None:
    """One row per job_id. Returns new id when inserted, None if duplicate job_id."""
    nid = str(uuid.uuid4())
    timestamp = now_iso()
    body_s = body if body is not None else ""
    try:
        with connect() as db:
            db.execute(
                """
                INSERT INTO notifications (id, job_id, kind, title, body, read, created_at)
                VALUES (?, ?, ?, ?, ?, 0, ?)
                """,
                (nid, job_id_str, kind, title, body_s, timestamp),
            )
            db.commit()
    except sqlite3.IntegrityError:
        return None
    return nid


def list_notifications(limit: int = 30, unread_only: bool = False) -> list[dict[str, Any]]:
    sql = "SELECT id, job_id, kind, title, body, read, created_at FROM notifications"
    params: list[Any] = []
    if unread_only:
        sql += " WHERE read = 0"
    sql += " ORDER BY datetime(created_at) DESC LIMIT ?"
    params.append(limit)
    with connect() as db:
        rows = db.execute(sql, params).fetchall()
    return [dict(row) for row in rows]


def unread_notification_count() -> int:
    with connect() as db:
        row = db.execute("SELECT COUNT(*) AS n FROM notifications WHERE read = 0").fetchone()
        return int(row["n"]) if row else 0


def mark_notification_read(notification_id: str) -> bool:
    with connect() as db:
        cur = db.execute(
            "UPDATE notifications SET read = 1 WHERE id = ? AND read = 0",
            (notification_id,),
        )
        db.commit()
        return cur.rowcount > 0


def mark_all_notifications_read() -> None:
    with connect() as db:
        db.execute("UPDATE notifications SET read = 1 WHERE read = 0")
        db.commit()


def safe_filename(name: str) -> str:
    clean = Path(name).name.replace(" ", "_")
    return clean or "audio.webm"
