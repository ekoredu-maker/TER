from __future__ import annotations

import base64
import json
import secrets
import sys
import threading
import webbrowser
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[2]
VENDOR = ROOT / "vendor"
if VENDOR.exists() and str(VENDOR) not in sys.path:
    sys.path.insert(0, str(VENDOR))

from app.backend.services.backup import create_backup_zip, restore_backup_bytes
from app.backend.services.excel import parse_trip_file
from app.backend.services.files import (
    receipt_path,
    safe_name,
    save_receipt,
    save_signature,
    signature_path,
)
from app.backend.services.hwpx import generate_hwpx
from app.backend.services.store import SQLiteStore
from app.backend.services.timeutils import iso_kst, stamp_kst
from app.backend.services.validators import validate_settlement

DATA_DIR = ROOT / "data"
RECEIPTS_DIR = DATA_DIR / "receipts"
SIGNATURE_DIR = DATA_DIR / "signature"
OUTPUT_DIR = ROOT / "output"
BACKUP_DIR = ROOT / "backup"
LOG_DIR = ROOT / "logs"
TEMPLATE_PATH = ROOT / "template" / "여비정산서(양식).hwpx"

for directory in (DATA_DIR, RECEIPTS_DIR, SIGNATURE_DIR, OUTPUT_DIR, BACKUP_DIR, LOG_DIR):
    directory.mkdir(parents=True, exist_ok=True)

STORE = SQLiteStore(DATA_DIR / "app.db")
APP_TOKEN = secrets.token_urlsafe(32)


def _json_bytes(value) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def _decode_base64(value: str) -> bytes:
    if not value:
        return b""
    return base64.b64decode(value, validate=True)


def _encode_file(path: Path) -> str:
    return base64.b64encode(Path(path).read_bytes()).decode("ascii")


def _settings() -> dict:
    row = STORE.get("settings", "default")
    if not row:
        return {}
    return dict(row.get("value") or {})


def _save_settings(value: dict) -> None:
    STORE.put("settings", {"id": "default", "value": value})


class Handler(SimpleHTTPRequestHandler):
    server_version = "TripExpenseHybrid/2.0-beta2.2"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt: str, *args) -> None:
        stamp = iso_kst()
        line = f"[{stamp}] {self.client_address[0]} {fmt % args}\n"
        try:
            with (LOG_DIR / "server.log").open("a", encoding="utf-8") as fp:
                fp.write(line)
        except OSError:
            pass

    def _send_json(self, value, status=HTTPStatus.OK):
        body = _json_bytes(value)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw.decode("utf-8"))

    def _authorized(self) -> bool:
        return secrets.compare_digest(self.headers.get("X-App-Token", ""), APP_TOKEN)

    def _require_auth(self) -> bool:
        if self._authorized():
            return True
        self._send_json({"ok": False, "error": "forbidden"}, HTTPStatus.FORBIDDEN)
        return False

    def _query_authorized(self, parsed) -> bool:
        supplied = (parse_qs(parsed.query).get("token") or [""])[0]
        return bool(supplied) and secrets.compare_digest(supplied, APP_TOKEN)

    def _send_file(self, file_path: Path, mime_type: str, download_name: str = "") -> None:
        data = Path(file_path).read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", mime_type or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "private, max-age=60")
        if download_name:
            self.send_header("Content-Disposition", "inline")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/health":
            self._send_json({
                "ok": True,
                "version": "2.0-beta2.2",
                "time": iso_kst(),
                "python": sys.version.split()[0],
                "templateReady": TEMPLATE_PATH.is_file(),
            })
            return

        if path == "/api/bootstrap":
            query = parse_qs(parsed.query)
            supplied = (query.get("token") or [""])[0]
            if not secrets.compare_digest(supplied, APP_TOKEN):
                self._send_json({"ok": False, "error": "forbidden"}, HTTPStatus.FORBIDDEN)
                return
            self._send_json({"ok": True, "token": APP_TOKEN, "templateReady": TEMPLATE_PATH.is_file()})
            return

        if path == "/api/receipt/file":
            if not self._query_authorized(parsed):
                self._send_json({"ok": False, "error": "forbidden"}, HTTPStatus.FORBIDDEN)
                return
            item_id = (parse_qs(parsed.query).get("id") or [""])[0]
            item = STORE.get("receipts", item_id)
            if not item:
                self._send_json({"ok": False, "error": "영수증 정보를 찾을 수 없습니다."}, HTTPStatus.NOT_FOUND)
                return
            file_path = receipt_path(RECEIPTS_DIR, item)
            if not file_path.is_file():
                self._send_json({"ok": False, "error": "영수증 파일을 찾을 수 없습니다."}, HTTPStatus.NOT_FOUND)
                return
            self._send_file(
                file_path,
                str(item.get("mimeType") or "application/octet-stream"),
                str(item.get("fileName") or file_path.name),
            )
            return

        if path == "/api/signature/file":
            if not self._query_authorized(parsed):
                self._send_json({"ok": False, "error": "forbidden"}, HTTPStatus.FORBIDDEN)
                return
            settings = _settings()
            meta = settings.get("signatureFile") or {}
            file_path = signature_path(SIGNATURE_DIR, meta) if meta else None
            if not file_path or not file_path.is_file():
                self._send_json({"ok": False, "error": "서명 파일을 찾을 수 없습니다."}, HTTPStatus.NOT_FOUND)
                return
            self._send_file(
                file_path,
                str(meta.get("mimeType") or "image/png"),
                str(meta.get("fileName") or file_path.name),
            )
            return

        if path.startswith("/api/store/"):
            if not self._require_auth():
                return
            store_name = path.split("/", 3)[3]
            try:
                self._send_json({"ok": True, "items": STORE.get_all(store_name)})
            except ValueError as exc:
                self._send_json({"ok": False, "error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return

        if path.startswith("/api/"):
            self._send_json({"ok": False, "error": "not found"}, HTTPStatus.NOT_FOUND)
            return

        self.path = parsed.path or "/"
        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if not self._require_auth():
            return

        try:
            payload = self._read_json()
        except Exception:
            self._send_json({"ok": False, "error": "invalid json"}, HTTPStatus.BAD_REQUEST)
            return

        try:
            if path == "/api/store/put":
                STORE.put(payload["store"], payload["value"])
                self._send_json({"ok": True})
                return

            if path == "/api/store/put-bulk":
                STORE.put_bulk(payload["store"], payload.get("values") or [])
                self._send_json({"ok": True})
                return

            if path == "/api/store/delete":
                STORE.delete(payload["store"], str(payload["id"]))
                self._send_json({"ok": True})
                return

            if path == "/api/store/clear":
                STORE.clear(payload["store"])
                self._send_json({"ok": True})
                return

            if path == "/api/excel/parse":
                filename = str(payload.get("filename") or "출장목록.xlsx")
                raw = _decode_base64(payload.get("dataBase64") or "")
                self._send_json({"ok": True, **parse_trip_file(filename, raw)})
                return

            if path == "/api/validate":
                result = validate_settlement(
                    payload.get("settlement") or {},
                    int(payload.get("receiptCount") or 0),
                )
                self._send_json({"ok": result.ok, "errors": result.errors})
                return

            if path == "/api/receipt/upload":
                raw = _decode_base64(payload.get("dataBase64") or "")
                if not raw:
                    raise ValueError("영수증 파일 내용이 비어 있습니다.")
                item = save_receipt(
                    RECEIPTS_DIR,
                    filename=str(payload.get("filename") or "receipt"),
                    data=raw,
                    mime_type=str(payload.get("mimeType") or ""),
                )
                item.update({
                    "settlementId": str(payload.get("settlementId") or ""),
                    "tripId": str(payload.get("tripId") or ""),
                    "type": str(payload.get("type") or "기타"),
                    "createdAt": iso_kst(),
                    "storage": "python-file",
                })
                STORE.put("receipts", item)
                self._send_json({"ok": True, "item": item})
                return

            if path == "/api/receipt/data":
                item_id = str(payload.get("id") or "")
                item = STORE.get("receipts", item_id)
                if not item:
                    raise ValueError("영수증 정보를 찾을 수 없습니다.")
                file_path = receipt_path(RECEIPTS_DIR, item)
                if not file_path.is_file():
                    raise ValueError("영수증 파일을 찾을 수 없습니다.")
                self._send_json({
                    "ok": True,
                    "id": item_id,
                    "mimeType": item.get("mimeType") or "application/octet-stream",
                    "fileName": item.get("fileName") or file_path.name,
                    "dataBase64": _encode_file(file_path),
                })
                return

            if path == "/api/receipt/delete":
                item_id = str(payload.get("id") or "")
                item = STORE.get("receipts", item_id)
                if item:
                    file_path = receipt_path(RECEIPTS_DIR, item)
                    if file_path.is_file():
                        file_path.unlink()
                    STORE.delete("receipts", item_id)
                self._send_json({"ok": True})
                return

            if path == "/api/signature/upload":
                raw = _decode_base64(payload.get("dataBase64") or "")
                if not raw:
                    raise ValueError("서명 이미지 내용이 비어 있습니다.")
                old_settings = _settings()
                old_meta = old_settings.get("signatureFile") or {}
                old_path = signature_path(SIGNATURE_DIR, old_meta) if old_meta else None

                meta = save_signature(
                    SIGNATURE_DIR,
                    filename=str(payload.get("filename") or "signature.png"),
                    data=raw,
                )
                meta["mimeType"] = str(payload.get("mimeType") or meta.get("mimeType") or "image/png")
                meta["updatedAt"] = iso_kst()
                old_settings["signatureFile"] = meta
                old_settings["signatureDataUrl"] = ""
                _save_settings(old_settings)

                if old_path and old_path.is_file() and old_path != signature_path(SIGNATURE_DIR, meta):
                    old_path.unlink()

                self._send_json({"ok": True, "signatureFile": meta})
                return

            if path == "/api/signature/data":
                settings = _settings()
                meta = settings.get("signatureFile") or {}
                if not meta:
                    self._send_json({"ok": True, "signatureFile": None, "dataBase64": ""})
                    return
                file_path = signature_path(SIGNATURE_DIR, meta)
                if not file_path.is_file():
                    self._send_json({"ok": True, "signatureFile": None, "dataBase64": ""})
                    return
                self._send_json({
                    "ok": True,
                    "signatureFile": meta,
                    "mimeType": meta.get("mimeType") or "image/png",
                    "dataBase64": _encode_file(file_path),
                })
                return

            if path == "/api/signature/delete":
                settings = _settings()
                meta = settings.pop("signatureFile", None) or {}
                settings["signatureDataUrl"] = ""
                if meta:
                    file_path = signature_path(SIGNATURE_DIR, meta)
                    if file_path.is_file():
                        file_path.unlink()
                _save_settings(settings)
                self._send_json({"ok": True})
                return

            if path == "/api/backup/create":
                filename = safe_name(f"출장정산백업_{stamp_kst()}.zip")
                target = BACKUP_DIR / filename
                create_backup_zip(
                    store=STORE,
                    receipts_dir=RECEIPTS_DIR,
                    signature_dir=SIGNATURE_DIR,
                    target=target,
                )
                self._send_json({
                    "ok": True,
                    "filename": target.name,
                    "dataBase64": _encode_file(target),
                })
                return

            if path == "/api/backup/restore":
                raw = _decode_base64(payload.get("dataBase64") or "")
                if not raw:
                    raise ValueError("백업 ZIP 파일이 비어 있습니다.")
                restore_backup_bytes(
                    store=STORE,
                    receipts_dir=RECEIPTS_DIR,
                    signature_dir=SIGNATURE_DIR,
                    data=raw,
                    filename=str(payload.get("filename") or "backup.zip"),
                )
                self._send_json({"ok": True})
                return

            if path == "/api/reset":
                for store_name in ("trips", "settlements", "receipts", "settings"):
                    STORE.clear(store_name)
                for directory in (RECEIPTS_DIR, SIGNATURE_DIR):
                    for child in directory.iterdir():
                        if child.is_file():
                            child.unlink()
                self._send_json({"ok": True})
                return

            if path == "/api/hwpx/generate":
                if not TEMPLATE_PATH.is_file():
                    raise FileNotFoundError(
                        "template/여비정산서(양식).hwpx 파일이 없습니다. 기준양식을 template 폴더에 넣어 주세요."
                    )
                settlement = dict(payload.get("settlement") or {})
                receipt_count = int(payload.get("receiptCount") or 0)
                km_rate = float(payload.get("kmRate") or 200)
                check = validate_settlement(settlement, receipt_count=receipt_count)
                if not check.ok:
                    self._send_json({"ok": False, "errors": check.errors}, HTTPStatus.BAD_REQUEST)
                    return

                applicant = safe_name(str(settlement.get("name") or "신청인"))
                date_key = str(settlement.get("settlementDate") or settlement.get("startDate") or "").replace("-", "")
                filename = safe_name(f"여비정산서_{applicant}_{date_key or stamp_kst()}.hwpx")
                target = OUTPUT_DIR / filename
                if target.exists():
                    target = OUTPUT_DIR / safe_name(
                        f"여비정산서_{applicant}_{date_key or 'output'}_{stamp_kst()}.hwpx"
                    )
                generate_hwpx(
                    template_path=TEMPLATE_PATH,
                    output_path=target,
                    settlement=settlement,
                    receipt_count=receipt_count,
                    km_rate=km_rate,
                )
                self._send_json({
                    "ok": True,
                    "filename": target.name,
                    "savedPath": str(target),
                    "dataBase64": _encode_file(target),
                })
                return

            if path == "/api/shutdown":
                self._send_json({"ok": True})
                threading.Thread(target=self.server.shutdown, daemon=True).start()
                return

        except Exception as exc:
            self._send_json({"ok": False, "error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return

        self._send_json({"ok": False, "error": "not found"}, HTTPStatus.NOT_FOUND)


def serve(open_browser: bool = True) -> int:
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    host, port = server.server_address
    url = f"http://{host}:{port}/?token={APP_TOKEN}"
    print("개인출장·여비정산 Hybrid v2.0-beta2.2")
    print(f"URL: {url}")
    if open_browser:
        threading.Timer(0.35, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(serve())


# Copyright 2026@박주가리교감 All rights reserved.
