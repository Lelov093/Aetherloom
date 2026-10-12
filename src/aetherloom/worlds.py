"""World identity and lifecycle, persisted independently from browser state."""

import sqlite3
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4


class WorldNotFound(Exception):
    pass


class StaleWorld(Exception):
    pass


class WorldRepository:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS worlds (
                    id TEXT PRIMARY KEY, name TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    archived INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                    version INTEGER NOT NULL DEFAULT 1
                )
            """)

    @contextmanager
    def connection(self):
        conn = sqlite3.connect(self.path, timeout=5)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def list(self, archived: bool = False):
        with self.connection() as conn:
            return [dict(row) for row in conn.execute(
                "SELECT * FROM worlds WHERE archived = ? ORDER BY updated_at DESC, id",
                (archived,),
            )]

    def get(self, world_id: str):
        with self.connection() as conn:
            row = conn.execute("SELECT * FROM worlds WHERE id = ?", (world_id,)).fetchone()
            if row is None:
                raise WorldNotFound
            return dict(row)

    def create(self, name: str, description: str):
        world_id, now = str(uuid4()), datetime.now(UTC).isoformat()
        with self.connection() as conn:
            conn.execute(
                "INSERT INTO worlds (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                (world_id, name, description, now, now),
            )
        return self.get(world_id)

    def update(self, world_id: str, version: int, changes: dict):
        allowed = {key: value for key, value in changes.items() if key in {"name", "description", "archived"}}
        with self.connection() as conn:
            assignments = ", ".join(f"{key} = ?" for key in allowed)
            if assignments:
                assignments += ", "
            cursor = conn.execute(
                f"UPDATE worlds SET {assignments}updated_at = ?, version = version + 1 WHERE id = ? AND version = ?",
                (*allowed.values(), datetime.now(UTC).isoformat(), world_id, version),
            )
            if cursor.rowcount == 0:
                if conn.execute("SELECT id FROM worlds WHERE id = ?", (world_id,)).fetchone() is None:
                    raise WorldNotFound
                raise StaleWorld
            # Read inside the transaction so this response corresponds to this write.
            return dict(conn.execute("SELECT * FROM worlds WHERE id = ?", (world_id,)).fetchone())
