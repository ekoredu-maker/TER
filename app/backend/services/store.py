from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from threading import RLock
from typing import Any, Iterator

ALLOWED_STORES = {"trips", "settlements", "receipts", "settings"}


class SQLiteStore:
    def __init__(self, db_path: Path):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = RLock()
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=15)
        conn.row_factory = sqlite3.Row
        return conn

    @contextmanager
    def _connection(self, *, write: bool = False) -> Iterator[sqlite3.Connection]:
        conn = self._connect()
        try:
            yield conn
            if write:
                conn.commit()
        except Exception:
            if write:
                conn.rollback()
            raise
        finally:
            conn.close()

    def _init_db(self) -> None:
        with self._connection(write=True) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS app_store (
                    store_name TEXT NOT NULL,
                    item_id TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    PRIMARY KEY (store_name, item_id)
                )
            """)

    @staticmethod
    def _check_store(store_name: str) -> None:
        if store_name not in ALLOWED_STORES:
            raise ValueError(f"unsupported store: {store_name}")

    def get_all(self, store_name: str) -> list[dict[str, Any]]:
        self._check_store(store_name)
        with self._lock, self._connection() as conn:
            rows = conn.execute(
                "SELECT payload FROM app_store WHERE store_name=? ORDER BY rowid",
                (store_name,),
            ).fetchall()
        return [json.loads(row["payload"]) for row in rows]

    def get(self, store_name: str, item_id: str) -> dict[str, Any] | None:
        self._check_store(store_name)
        with self._lock, self._connection() as conn:
            row = conn.execute(
                "SELECT payload FROM app_store WHERE store_name=? AND item_id=?",
                (store_name, item_id),
            ).fetchone()
        return json.loads(row["payload"]) if row else None

    def put(self, store_name: str, value: dict[str, Any]) -> None:
        self._check_store(store_name)
        item_id = str(value.get("id") or "").strip()
        if not item_id:
            raise ValueError("item id is required")
        payload = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
        with self._lock, self._connection(write=True) as conn:
            conn.execute(
                """
                INSERT INTO app_store(store_name,item_id,payload)
                VALUES(?,?,?)
                ON CONFLICT(store_name,item_id)
                DO UPDATE SET payload=excluded.payload
                """,
                (store_name, item_id, payload),
            )

    def put_bulk(self, store_name: str, values: list[dict[str, Any]]) -> None:
        self._check_store(store_name)
        with self._lock, self._connection(write=True) as conn:
            for value in values:
                item_id = str(value.get("id") or "").strip()
                if not item_id:
                    continue
                conn.execute(
                    """
                    INSERT INTO app_store(store_name,item_id,payload)
                    VALUES(?,?,?)
                    ON CONFLICT(store_name,item_id)
                    DO UPDATE SET payload=excluded.payload
                    """,
                    (
                        store_name,
                        item_id,
                        json.dumps(value, ensure_ascii=False, separators=(",", ":")),
                    ),
                )

    def delete(self, store_name: str, item_id: str) -> None:
        self._check_store(store_name)
        with self._lock, self._connection(write=True) as conn:
            conn.execute(
                "DELETE FROM app_store WHERE store_name=? AND item_id=?",
                (store_name, item_id),
            )

    def clear(self, store_name: str) -> None:
        self._check_store(store_name)
        with self._lock, self._connection(write=True) as conn:
            conn.execute("DELETE FROM app_store WHERE store_name=?", (store_name,))


JsonStore = SQLiteStore

# Copyright 2026@박주가리교감 All rights reserved.
