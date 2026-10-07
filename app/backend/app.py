from __future__ import annotations

import base64
import json
import mimetypes
import secrets
import sys
import threading
import urllib.parse
import webbrowser
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[2]
FRONTEND_DIR = ROOT / "app" / "frontend"
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
from app.backend.services.hwpx import generate_hwpx, validate_hwpx
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

for directory in (
    DATA_DIR,
    RECEIPTS_DIR,
    SIGNATURE_DIR,
    OUTPUT_DIR,
    BACKUP_DIR,
    LOG_DIR,
    FRONTEND_DIR,
):
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


def _remove_receipt_file(item: dict | None) -> None:
    if not item:
        return
    path = receipt_path(RECEIPTS_DIR, item)
    try:
        if path.is_file():
            path.unlink()
    except OSError:
        pass


def _remove_signature_file(meta: dict | None) -> None:
    if not meta:
        return
    path = signature_path(SIGNATURE_DIR, meta)
    try:
        if path.is_file():
            path.unlink()
    except OSError:
        pass


class Handler(SimpleHTTPRequestHandler):
    server_version = "TripExpenseHybrid/2.0-RC1.2"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(FRONTEND_DIR), **kwargs)

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

    def _send_bytes(
        self,
        data: bytes,
        mime_type: str = "application/octet-stream",
        *,
        filename: str | None = None,
        attachment: bool = False,
    ) -> None:
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", mime_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "private, no-store")
        if filename:
            encoded = urllib.parse.quote(filename, safe="")
            disposition = "attachment" if attachment else "inline"
            self.send_header(
                "Content-Disposition",
                f"{disposition}; filename*=UTF-8''{encoded}",
            )
        self.end_headers()
        self.wfile.write(data)

    def _read_bytes(self) -> bytes:
        length = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(length) if length else b""

    def _read_json(self):
        raw = self._read_bytes() or b"{}"
        return json.loads(raw.decode("utf-8"))

    def _header_filename(self, default: str = "file") -> str:
        raw = self.headers.get("X-Filename") or ""
        try:
            return safe_name(urllib.parse.unquote(raw)) or default
        except Exception:
            return default

    def _authorized(self) -> bool:
        return secrets.compare_digest(self.headers.get("X-App-Token", ""), APP_TOKEN)

    def _query_authorized(self, parsed) -> bool:
        supplied = (parse_qs(parsed.query).get("token") or [""])[0]
        return bool(supplied) and secrets.compare_digest(supplied, APP_TOKEN)

    def _require_auth(self, parsed=None) -> bool:
        if self._authorized() or (parsed is not None and self._query_authorized(parsed)):
            return True
        self._send_json({"ok": False, "error": "forbidden"}, HTTPStatus.FORBIDDEN)
        return False

    def _serve_output(self, parsed) -> bool:
        if not parsed.path.startswith("/output/"):
            return False
        if not self._require_auth(parsed):
            return True
        name = safe_name(Path(parsed.path).name)
        path = OUTPUT_DIR / name
        if not path.is_file():
            self._send_json({"ok": False, "error": "output not found"}, HTTPStatus.NOT_FOUND)
            return True
        mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
        self._send_bytes(path.read_bytes(), mime, filename=name, attachment=True)
        return True

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/health":
            self._send_json({
                "ok": True,
                "version": "2.0-RC1.2",
                "time": iso_kst(),
                "python": sys.version.split()[0],
                "templateReady": TEMPLATE_PATH.is_file(),
            })
            return

        if path == "/api/bootstrap":
            supplied = (parse_qs(parsed.query).get("token") or [""])[0]
            if not secrets.compare_digest(supplied, APP_TOKEN):
                self._send_json({"ok": False, "error": "forbidden"}, HTTPStatus.FORBIDDEN)
                return
            self._send_json({
                "ok": True,
                "token": APP_TOKEN,
                "templateReady": TEMPLATE_PATH.is_file(),
            })
            return

        if self._serve_output(parsed):
            return

        if path == "/api/template/status":
            if not self._require_auth(parsed):
                return
            ready = TEMPLATE_PATH.is_file()
            validation = validate_hwpx(TEMPLATE_PATH) if ready else {"ok": False, "errors": ["기준양식 없음"]}
            self._send_json({
                "ok": True,
                "ready": ready and validation.get("ok", False),
                "filename": TEMPLATE_PATH.name if ready else "",
                "structureOk": bool(validation.get("ok")),
                "errors": validation.get("errors") or [],
                "connectedGroups": [
                    "소속·직급·성명·복수출장자",
                    "출장일시·출장지·출장목적·식사제공여부",
                    "숙박비 상한액·실소요액·초과지출사유",
                    "친지집 숙박·공동숙박·공동숙박 추가지급 신청자",
                    "자가용 일자·출발지·도착지·거리·금액·운전자·비고",
                    "대중교통 일자·교통편·출발지·도착지·등급·금액",
                    "영수증 첨부문구·신청일·신청인",
                ],
            })
            return

        if path == "/api/backup":
            if not self._require_auth(parsed):
                return
            target = BACKUP_DIR / safe_name(f"출장정산백업_{stamp_kst()}.zip")
            create_backup_zip(
                store=STORE,
                receipts_dir=RECEIPTS_DIR,
                signature_dir=SIGNATURE_DIR,
                target=target,
            )
            self._send_bytes(
                target.read_bytes(),
                "application/zip",
                filename=target.name,
                attachment=True,
            )
            return

        if path.startswith("/api/receipts/") and path.endswith("/content"):
            if not self._require_auth(parsed):
                return
            item_id = path[len("/api/receipts/") : -len("/content")].strip("/")
            item = STORE.get("receipts", item_id)
            if not item:
                self._send_json({"ok": False, "error": "영수증 정보를 찾을 수 없습니다."}, HTTPStatus.NOT_FOUND)
                return
            file_path = receipt_path(RECEIPTS_DIR, item)
            if not file_path.is_file():
                self._send_json({"ok": False, "error": "영수증 파일을 찾을 수 없습니다."}, HTTPStatus.NOT_FOUND)
                return
            self._send_bytes(
                file_path.read_bytes(),
                str(item.get("mimeType") or "application/octet-stream"),
                filename=str(item.get("fileName") or file_path.name),
            )
            return

        if path in {"/api/signature/content", "/api/signature/file"}:
            if not self._require_auth(parsed):
                return
            settings = _settings()
            meta = settings.get("signatureFile") or {}
            file_path = signature_path(SIGNATURE_DIR, meta) if meta else None
            if not file_path or not file_path.is_file():
                self._send_json({"ok": False, "error": "서명 파일을 찾을 수 없습니다."}, HTTPStatus.NOT_FOUND)
                return
            self._send_bytes(
                file_path.read_bytes(),
                str(meta.get("mimeType") or "image/png"),
                filename=str(meta.get("fileName") or file_path.name),
            )
            return

        if path == "/api/receipt/file":
            if not self._require_auth(parsed):
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
            self._send_bytes(
                file_path.read_bytes(),
                str(item.get("mimeType") or "application/octet-stream"),
                filename=str(item.get("fileName") or file_path.name),
            )
            return

        if path.startswith("/api/store/"):
            if not self._require_auth(parsed):
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

    def do_PUT(self):
        parsed = urlparse(self.path)
        if not self._require_auth(parsed):
            return
        path = parsed.path
        parts = path.strip("/").split("/")
        if len(parts) == 4 and parts[:2] == ["api", "store"]:
            store_name, item_id = parts[2], parts[3]
            try:
                value = self._read_json()
                value["id"] = str(value.get("id") or item_id)
                STORE.put(store_name, value)
                self._send_json({"ok": True})
            except Exception as exc:
                self._send_json({"ok": False, "error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return
        self._send_json({"ok": False, "error": "not found"}, HTTPStatus.NOT_FOUND)

    def do_DELETE(self):
        parsed = urlparse(self.path)
        if not self._require_auth(parsed):
            return
        parts = parsed.path.strip("/").split("/")
        if len(parts) == 4 and parts[:2] == ["api", "store"]:
            store_name, item_id = parts[2], parts[3]
            try:
                if store_name == "receipts":
                    _remove_receipt_file(STORE.get("receipts", item_id))
                STORE.delete(store_name, item_id)
                self._send_json({"ok": True})
            except Exception as exc:
                self._send_json({"ok": False, "error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return
        self._send_json({"ok": False, "error": "not found"}, HTTPStatus.NOT_FOUND)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if not self._require_auth(parsed):
            return

        try:
            # Desktop beta2.x store compatibility
            parts = path.strip("/").split("/")
            if len(parts) == 4 and parts[:2] == ["api", "store"] and parts[3] == "bulk":
                values = self._read_json()
                STORE.put_bulk(parts[2], list(values or []))
                self._send_json({"ok": True})
                return

            if len(parts) == 4 and parts[:2] == ["api", "store"] and parts[3] == "clear":
                store_name = parts[2]
                if store_name == "receipts":
                    for item in STORE.get_all("receipts"):
                        _remove_receipt_file(item)
                STORE.clear(store_name)
                self._send_json({"ok": True})
                return

            # Newer bridge store API compatibility
            if path == "/api/store/put":
                payload = self._read_json()
                STORE.put(payload["store"], payload["value"])
                self._send_json({"ok": True})
                return

            if path == "/api/store/put-bulk":
                payload = self._read_json()
                STORE.put_bulk(payload["store"], payload.get("values") or [])
                self._send_json({"ok": True})
                return

            if path == "/api/store/delete":
                payload = self._read_json()
                store_name = payload["store"]
                item_id = str(payload["id"])
                if store_name == "receipts":
                    _remove_receipt_file(STORE.get("receipts", item_id))
                STORE.delete(store_name, item_id)
                self._send_json({"ok": True})
                return

            if path == "/api/store/clear":
                payload = self._read_json()
                store_name = payload["store"]
                if store_name == "receipts":
                    for item in STORE.get_all("receipts"):
                        _remove_receipt_file(item)
                STORE.clear(store_name)
                self._send_json({"ok": True})
                return

            if path == "/api/excel/parse":
                filename = self._header_filename("출장목록.xlsx")
                content_type = self.headers.get("Content-Type") or ""
                if "application/json" in content_type:
                    payload = self._read_json()
                    filename = str(payload.get("filename") or filename)
                    raw = _decode_base64(payload.get("dataBase64") or "")
                else:
                    raw = self._read_bytes()
                self._send_json({"ok": True, **parse_trip_file(filename, raw)})
                return

            if path == "/api/receipts":
                query = parse_qs(parsed.query)
                raw = self._read_bytes()
                if not raw:
                    raise ValueError("영수증 파일 내용이 비어 있습니다.")
                filename = self._header_filename("receipt")
                item = save_receipt(
                    RECEIPTS_DIR,
                    filename=filename,
                    data=raw,
                    mime_type=self.headers.get("Content-Type") or "",
                )
                item.update({
                    "settlementId": (query.get("settlementId") or [""])[0],
                    "tripId": (query.get("tripId") or [""])[0],
                    "type": (query.get("type") or ["기타"])[0],
                    "createdAt": iso_kst(),
                    "storage": "python-file",
                })
                STORE.put("receipts", item)
                self._send_json({"ok": True, "item": item})
                return

            if path == "/api/receipt/upload":
                payload = self._read_json()
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

            if path == "/api/receipt/delete":
                payload = self._read_json()
                item_id = str(payload.get("id") or "")
                item = STORE.get("receipts", item_id)
                _remove_receipt_file(item)
                if item:
                    STORE.delete("receipts", item_id)
                self._send_json({"ok": True})
                return

            if path == "/api/signature":
                raw = self._read_bytes()
                if not raw:
                    raise ValueError("서명 이미지 내용이 비어 있습니다.")
                settings = _settings()
                _remove_signature_file(settings.get("signatureFile"))
                meta = save_signature(
                    SIGNATURE_DIR,
                    filename=self._header_filename("signature.png"),
                    data=raw,
                )
                meta["mimeType"] = self.headers.get("Content-Type") or meta.get("mimeType") or "image/png"
                meta["updatedAt"] = iso_kst()
                settings["signatureFile"] = meta
                settings.pop("signatureDataUrl", None)
                _save_settings(settings)
                self._send_json({"ok": True, "meta": meta})
                return

            if path == "/api/signature/upload":
                payload = self._read_json()
                raw = _decode_base64(payload.get("dataBase64") or "")
                if not raw:
                    raise ValueError("서명 이미지 내용이 비어 있습니다.")
                settings = _settings()
                _remove_signature_file(settings.get("signatureFile"))
                meta = save_signature(
                    SIGNATURE_DIR,
                    filename=str(payload.get("filename") or "signature.png"),
                    data=raw,
                )
                meta["mimeType"] = str(payload.get("mimeType") or meta.get("mimeType") or "image/png")
                meta["updatedAt"] = iso_kst()
                settings["signatureFile"] = meta
                settings.pop("signatureDataUrl", None)
                _save_settings(settings)
                self._send_json({"ok": True, "signatureFile": meta})
                return

            if path == "/api/signature/delete":
                settings = _settings()
                _remove_signature_file(settings.pop("signatureFile", None))
                settings.pop("signatureDataUrl", None)
                _save_settings(settings)
                self._send_json({"ok": True})
                return

            if path in {"/api/validate", "/api/settlement/validate"}:
                payload = self._read_json()
                settlement = payload.get("settlement") if "settlement" in payload else payload
                receipt_count = int(payload.get("receiptCount") or 0) if isinstance(payload, dict) else 0
                result = validate_settlement(settlement or {}, receipt_count=receipt_count)
                self._send_json({"ok": result.ok, "errors": result.errors, "warnings": result.warnings})
                return

            if path == "/api/template":
                raw = self._read_bytes()
                filename = self._header_filename("여비정산서(양식).hwpx")
                if not raw:
                    raise ValueError("HWPX 기준양식 파일이 비어 있습니다.")
                if not filename.lower().endswith(".hwpx"):
                    raise ValueError("기준양식은 .hwpx 파일만 등록할 수 있습니다.")

                TEMPLATE_PATH.parent.mkdir(parents=True, exist_ok=True)
                incoming = TEMPLATE_PATH.parent / ".incoming_template.hwpx"
                incoming.write_bytes(raw)
                check = validate_hwpx(incoming)
                if not check.get("ok"):
                    incoming.unlink(missing_ok=True)
                    raise ValueError("유효한 HWPX 양식이 아닙니다: " + "; ".join(check.get("errors") or []))

                if TEMPLATE_PATH.is_file():
                    template_backup_dir = BACKUP_DIR / "templates"
                    template_backup_dir.mkdir(parents=True, exist_ok=True)
                    backup_name = safe_name(f"여비정산서_기준양식_{stamp_kst()}.hwpx")
                    TEMPLATE_PATH.replace(template_backup_dir / backup_name)

                incoming.replace(TEMPLATE_PATH)
                self._send_json({
                    "ok": True,
                    "ready": True,
                    "filename": TEMPLATE_PATH.name,
                })
                return

            if path == "/api/hwpx":
                settlement = self._read_json()

                if str(settlement.get("status") or "").strip() == "exempt":
                    self._send_json(
                        {"ok": False, "error": "정산불요 상태에서는 HWPX 정산서를 생성하지 않습니다."},
                        HTTPStatus.BAD_REQUEST,
                    )
                    return
                if not str(settlement.get("settlementDate") or "").strip():
                    self._send_json(
                        {"ok": False, "error": "HWPX 생성 전 정산일자를 입력해 주세요."},
                        HTTPStatus.BAD_REQUEST,
                    )
                    return
                receipt_count = len([
                    x for x in STORE.get_all("receipts")
                    if x.get("settlementId") == settlement.get("id")
                ])
                result = validate_settlement(settlement, receipt_count=receipt_count)
                if not result.ok:
                    self._send_json({"ok": False, "error": "\n".join(result.errors), "errors": result.errors}, HTTPStatus.BAD_REQUEST)
                    return
                if not TEMPLATE_PATH.is_file():
                    raise FileNotFoundError("template/여비정산서(양식).hwpx가 없습니다.")
                settings = _settings()
                km_rate = float(settings.get("kmRate") or 200)
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
                    "url": f"/output/{urllib.parse.quote(target.name)}?token={urllib.parse.quote(APP_TOKEN)}",
                })
                return

            if path == "/api/hwpx/generate":
                payload = self._read_json()
                settlement = dict(payload.get("settlement") or {})

                if str(settlement.get("status") or "").strip() == "exempt":
                    self._send_json(
                        {"ok": False, "error": "정산불요 상태에서는 HWPX 정산서를 생성하지 않습니다."},
                        HTTPStatus.BAD_REQUEST,
                    )
                    return
                if not str(settlement.get("settlementDate") or "").strip():
                    self._send_json(
                        {"ok": False, "error": "HWPX 생성 전 정산일자를 입력해 주세요."},
                        HTTPStatus.BAD_REQUEST,
                    )
                    return
                receipt_count = int(payload.get("receiptCount") or 0)
                km_rate = float(payload.get("kmRate") or 200)
                result = validate_settlement(settlement, receipt_count=receipt_count)
                if not result.ok:
                    self._send_json({"ok": False, "errors": result.errors}, HTTPStatus.BAD_REQUEST)
                    return
                if not TEMPLATE_PATH.is_file():
                    raise FileNotFoundError("template/여비정산서(양식).hwpx가 없습니다.")
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

            if path == "/api/backup/create":
                target = BACKUP_DIR / safe_name(f"출장정산백업_{stamp_kst()}.zip")
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

            if path in {"/api/backup/restore", "/api/restore"}:
                content_type = self.headers.get("Content-Type") or ""
                if path == "/api/backup/restore" and "application/json" in content_type:
                    payload = self._read_json()
                    raw = _decode_base64(payload.get("dataBase64") or "")
                    filename = str(payload.get("filename") or "backup.zip")
                else:
                    raw = self._read_bytes()
                    filename = self._header_filename("backup.zip")
                if not raw:
                    raise ValueError("백업 파일이 비어 있습니다.")
                restore_backup_bytes(
                    store=STORE,
                    receipts_dir=RECEIPTS_DIR,
                    signature_dir=SIGNATURE_DIR,
                    data=raw,
                    filename=filename,
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
    url = f"http://{host}:{port}/?token={urllib.parse.quote(APP_TOKEN)}"
    print("개인출장·여비정산 Hybrid v2.0-RC1.2")
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
