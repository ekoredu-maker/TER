from __future__ import annotations

import io
import json
import shutil
import zipfile
from pathlib import Path

from .store import SQLiteStore
from .timeutils import iso_kst

STORES = ("trips", "settlements", "receipts", "settings")


def create_backup_zip(*, store: SQLiteStore, receipts_dir: Path, signature_dir: Path, target: Path) -> Path:
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "exportedAt": iso_kst(),
        "stores": {name: store.get_all(name) for name in STORES},
    }
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("data.json", json.dumps(payload, ensure_ascii=False, indent=2))
        for folder_name, folder in (("receipts", Path(receipts_dir)), ("signature", Path(signature_dir))):
            if folder.exists():
                for path in folder.rglob("*"):
                    if path.is_file():
                        zf.write(path, arcname=f"{folder_name}/{path.name}")
    return target


def restore_backup_bytes(*, store: SQLiteStore, receipts_dir: Path, signature_dir: Path, data: bytes, filename: str = "backup.zip") -> None:
    if not filename.lower().endswith(".zip"):
        raise ValueError("ZIP 백업 파일만 복원할 수 있습니다.")

    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        names = set(zf.namelist())
        if "data.json" not in names:
            raise ValueError("유효한 백업 파일이 아닙니다.")
        payload = json.loads(zf.read("data.json").decode("utf-8"))

        for name in STORES:
            store.clear(name)
            store.put_bulk(name, list((payload.get("stores") or {}).get(name) or []))

        for folder_name, target in (("receipts", Path(receipts_dir)), ("signature", Path(signature_dir))):
            target.mkdir(parents=True, exist_ok=True)
            for child in target.iterdir():
                if child.is_file():
                    child.unlink()
                elif child.is_dir():
                    shutil.rmtree(child)

            prefix = folder_name + "/"
            for member in zf.infolist():
                if member.is_dir() or not member.filename.startswith(prefix):
                    continue
                leaf = Path(member.filename).name
                if not leaf:
                    continue
                (target / leaf).write_bytes(zf.read(member))


# Copyright 2026@박주가리교감 All rights reserved.
