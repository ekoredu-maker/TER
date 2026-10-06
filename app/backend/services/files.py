from __future__ import annotations

import mimetypes
import re
import uuid
from pathlib import Path


def safe_name(name: str) -> str:
    name = Path(name or "file").name
    name = re.sub(r'[\\/:*?"<>|]+', "_", name)
    return name[:180] or "file"


def _save_file(directory: Path, *, filename: str, data: bytes, prefix: str) -> dict:
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    original = safe_name(filename)
    suffix = Path(original).suffix.lower()
    stored = f"{prefix}_{uuid.uuid4().hex}{suffix}"
    path = directory / stored
    path.write_bytes(data)
    mime = mimetypes.guess_type(original)[0] or "application/octet-stream"
    return {
        "id": f"{prefix}_{uuid.uuid4().hex}",
        "fileName": original,
        "storedName": stored,
        "mimeType": mime,
        "size": len(data),
    }


def save_receipt(directory: Path, *, filename: str, data: bytes, mime_type: str = "") -> dict:
    meta = _save_file(directory, filename=filename, data=data, prefix="receipt")
    if mime_type:
        meta["mimeType"] = mime_type
    return meta


def save_signature(directory: Path, *, filename: str, data: bytes) -> dict:
    return _save_file(directory, filename=filename, data=data, prefix="signature")


def receipt_path(directory: Path, item: dict) -> Path:
    return Path(directory) / str(item.get("storedName") or "")


def signature_path(directory: Path, item: dict) -> Path:
    return Path(directory) / str(item.get("storedName") or "")


# Copyright 2026@박주가리교감 All rights reserved.
