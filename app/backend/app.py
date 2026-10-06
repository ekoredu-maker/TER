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

from app.backend.services.excel import parse_trip_file
from app.backend.services.store import SQLiteStore
from app.backend.services.validators import validate_settlement
from app.backend.services.timeutils import iso_kst

DATA_DIR = ROOT / "data"
OUTPUT_DIR = ROOT / "output"
LOG_DIR = ROOT / "logs"
for directory in (DATA_DIR, OUTPUT_DIR, LOG_DIR):
    directory.mkdir(parents=True, exist_ok=True)

STORE = SQLiteStore(DATA_DIR / "app.db")
APP_TOKEN = secrets.token_urlsafe(32)


def _json_bytes(value) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


class Handler(SimpleHTTPRequestHandler):
    server_version = "TripExpenseHybrid/2.0-beta2.1"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt: str, *args) -> None:
        stamp = iso_kst()
        line = f"[{stamp}] {self.client_address[0]} {fmt % args}\n"
        try:
            (LOG_DIR / "server.log").open("a", encoding="utf-8").write(line)
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

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/health":
            self._send_json({
                "ok": True,
                "version": "2.0-beta2.1",
                "time": iso_kst(),
                "python": sys.version.split()[0],
            })
            return

        if path == "/api/bootstrap":
            query = parse_qs(parsed.query)
            supplied = (query.get("token") or [""])[0]
            if not secrets.compare_digest(supplied, APP_TOKEN):
                self._send_json({"ok": False, "error": "forbidden"}, HTTPStatus.FORBIDDEN)
                return
            self._send_json({"ok": True, "token": APP_TOKEN})
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
                raw = base64.b64decode(payload.get("dataBase64") or "", validate=True)
                self._send_json({"ok": True, **parse_trip_file(filename, raw)})
                return

            if path == "/api/validate":
                result = validate_settlement(
                    payload.get("settlement") or {},
                    int(payload.get("receiptCount") or 0),
                )
                self._send_json({"ok": result.ok, "errors": result.errors})
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
    print(f"개인출장·여비정산 Hybrid v2.0-beta2.1")
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
