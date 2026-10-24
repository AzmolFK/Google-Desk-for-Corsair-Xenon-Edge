"""Google Desk: a loopback-only Windows companion. Standard-library runtime."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import socket
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit
import webbrowser

from secure_store import SecureStore
from google_api import Google, GoogleError
from keep_bridge import KeepBridge
from paired_widget import create_paired_widget

ROOT = Path(__file__).resolve().parent.parent


class LocalServer(ThreadingHTTPServer):
    allow_reuse_address = False

    def server_bind(self):
        if os.name == "nt":
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


class Desk:
    def __init__(self, data_dir, port=8765):
        self.port = port
        self.store = SecureStore(Path(data_dir) / "desk.bin")
        self.lock = threading.RLock()
        self.state = self.store.load()
        self.state.setdefault("widget_key", secrets.token_urlsafe(32))
        self.state.setdefault("accounts", {})
        self.state.setdefault("notes", [])
        self.admin_key = secrets.token_urlsafe(32)
        self.shutdown_callback = None
        self.save()
        self.google = Google(self.state, self.save, port)
        self.keep = KeepBridge(self.state)

    def save(self):
        with self.lock:
            self.store.save(self.state)

    def setup_url(self):
        return f"http://127.0.0.1:{self.port}/#session={self.admin_key}"

    def status(self, admin):
        return {"accounts": list(self.state["accounts"]), "clientConfigured": bool(self.state.get("client")),
                "keepConfigured": bool(self.state.get("keep_email")), "keepEmail": self.state.get("keep_email", ""),
                "admin": admin, "widgetKey": self.state["widget_key"] if admin else None}

    def aggregate(self, account, method):
        accounts = [account] if account and account != "all" else list(self.state["accounts"])
        result, errors = [], []
        for email in accounts:
            try:
                result.extend(method(email))
            except GoogleError as exc:
                errors.append({"account": email, "message": str(exc)})
        return {"items": result, "errors": errors, "updated": time.time()}


def make_handler(desk):
    class Handler(BaseHTTPRequestHandler):
        server_version = "GoogleDesk/0.3"

        def log_message(self, fmt, *args):
            # OAuth codes, email addresses and session keys must never enter request logs.
            pass

        def reply(self, status, payload, kind="application/json"):
            body = json.dumps(payload).encode() if kind == "application/json" else payload.encode() if isinstance(payload, str) else payload
            self.send_response(status)
            self.send_header("Content-Type", kind + ("; charset=utf-8" if kind.startswith("text/") else ""))
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self' http://127.0.0.1:8765; frame-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
            self.end_headers()
            self.wfile.write(body)

        def valid_host(self):
            return self.headers.get("Host") == f"127.0.0.1:{desk.port}"

        def authorization(self):
            auth = self.headers.get("Authorization", "")
            if not auth.startswith("Bearer "):
                return None
            value = auth[7:]
            if secrets.compare_digest(value, desk.admin_key):
                return "admin"
            if secrets.compare_digest(value, desk.state["widget_key"]):
                return "widget"
            return None

        def do_OPTIONS(self):
            if not self.valid_host():
                return self.reply(403, {"error": "Host rejected"})
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.end_headers()

        def do_GET(self):
            self.route(False)

        def do_POST(self):
            self.route(True)

        def route(self, post):
            if not self.valid_host():
                return self.reply(403, {"error": "Host rejected"})
            parsed = urlsplit(self.path)
            path, query = parsed.path, parse_qs(parsed.query)
            def get(name, default=""):
                return query.get(name, [default])[0]
            try:
                if path == "/oauth/callback" and not post:
                    if get("error"):
                        raise GoogleError("Google sign-in was cancelled or denied. Return to Settings and try again.")
                    desk.google.callback(get("state"), get("code"))
                    return self.reply(200, "<!DOCTYPE html><html><body style='background:#111820;color:#e9f0f5;font:20px system-ui;padding:60px'><h1>Google connected.</h1><p>You can close this tab and return to Google Desk.</p></body></html>", "text/html")
                if not path.startswith("/api/") and not post:
                    files = {"/": ("index.html", "text/html"), "/index.html": ("index.html", "text/html"),
                             "/app.js": ("app.js", "text/javascript"), "/styles.css": ("styles.css", "text/css"),
                             "/readability.css": ("readability.css", "text/css"),
                             "/pairing.js": ("pairing.js", "text/javascript"),
                             "/resources/icon.svg": ("resources/icon.svg", "image/svg+xml")}
                    if path not in files:
                        return self.reply(404, {"error": "Not found"})
                    file, kind = files[path]
                    return self.reply(200, (ROOT / "widget" / file).read_bytes(), kind)
                role = self.authorization()
                if not role:
                    return self.reply(401, {"error": "Open Google Desk.exe, or enter your widget pairing key."})
                data = {}
                if post:
                    if not self.headers.get("Content-Type", "").startswith("application/json"):
                        return self.reply(415, {"error": "JSON required"})
                    length = int(self.headers.get("Content-Length", "0"))
                    if not 0 <= length <= 1_100_000:
                        return self.reply(413, {"error": "Request too large"})
                    data = json.loads(self.rfile.read(length) or b"{}")
                    if not isinstance(data, dict):
                        raise ValueError("Invalid request")
                if path in ("/api/client", "/api/auth/start", "/api/disconnect", "/api/notes/import", "/api/keep/disconnect", "/api/shutdown", "/api/widget/install") and role != "admin":
                    return self.reply(403, {"error": "Manage accounts in the companion's Settings window."})
                if path == "/api/status" and not post:
                    return self.reply(200, desk.status(role == "admin"))
                if path == "/api/widget/install" and post:
                    with desk.lock:
                        output = create_paired_widget(ROOT / "Google-Desk.icuewidget", desk.store.path.parent / "Google-Desk-Paired.icuewidget", desk.state["widget_key"])
                    opened = False
                    if data.get("open", True):
                        try:
                            os.startfile(str(output))
                            opened = True
                        except OSError:
                            try:
                                os.startfile(str(output.parent))
                            except OSError:
                                pass
                    return self.reply(200, {"ok": True, "opened": opened, "filename": output.name, "message": "Import Google-Desk-Paired.icuewidget from the app's data folder. New instances will connect automatically."})
                if path == "/api/open-setup" and post:
                    webbrowser.open(desk.setup_url())
                    return self.reply(200, {"ok": True})
                if path == "/api/shutdown" and post:
                    self.reply(200, {"ok": True})
                    if desk.shutdown_callback:
                        threading.Thread(target=desk.shutdown_callback, daemon=True).start()
                    return
                if path == "/api/client" and post:
                    client = data.get("installed", data)
                    if not isinstance(client, dict) or not re.fullmatch(r"[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com", client.get("client_id", "")):
                        raise ValueError("Import an OAuth client JSON with application type Desktop app.")
                    if "web" in data:
                        raise ValueError("Create a Desktop app OAuth client, not a Web application client.")
                    if desk.state["accounts"] and desk.state.get("client", {}).get("client_id") != client["client_id"]:
                        raise ValueError("Disconnect existing accounts before changing the OAuth client.")
                    with desk.lock:
                        desk.state["client"] = {k: client[k] for k in ("client_id", "client_secret") if client.get(k)}
                        desk.save()
                    return self.reply(200, {"ok": True})
                if path == "/api/auth/start" and post:
                    return self.reply(200, {"url": desk.google.begin()})
                if path == "/api/disconnect" and post:
                    email = data.get("email", "")
                    with desk.lock:
                        desk.state["accounts"].pop(email, None)
                        desk.google.tokens.pop(email, None)
                        desk.google.cache.clear()
                        desk.save()
                    return self.reply(200, {"ok": True})
                if path == "/api/keep/disconnect" and post:
                    with desk.lock:
                        desk.state.pop("keep_email", None)
                        desk.state.pop("keep_token", None)
                        desk.keep.client = None
                        desk.save()
                    return self.reply(200, {"ok": True})
                if path == "/api/notes/import" and post:
                    imported = data.get("notes", [])
                    if not isinstance(imported, list) or len(imported) > 500:
                        raise ValueError("Import up to 500 Google Takeout note JSON files at a time.")
                    additions = []
                    for item in imported:
                        if not isinstance(item, dict) or not any(k in item for k in ("textContent", "listContent")):
                            raise ValueError("Select Google Keep note JSON files from a Google Takeout export.")
                        text = str(item.get("textContent", ""))[:100000]
                        if item.get("listContent"):
                            text = "\n".join(("[x] " if x.get("isChecked") else "[ ] ") + str(x.get("text", "")) for x in item["listContent"])[:100000]
                        title = str(item.get("title", "Untitled"))[:1000]
                        note_id = "import-" + hashlib.sha256((title + "\0" + text).encode()).hexdigest()[:24]
                        additions.append({"id": note_id, "title": title, "text": text, "pinned": bool(item.get("isPinned")), "source": "local", "imported": True, "updated": time.time()})
                    with desk.lock:
                        existing = {n["id"] for n in desk.state["notes"]}
                        fresh = [n for n in additions if n["id"] not in existing]
                        desk.state["notes"].extend(fresh)
                        desk.save()
                    return self.reply(200, {"imported": len(fresh)})
                if path == "/api/events" and not post:
                    start, end = get("start"), get("end")
                    from datetime import datetime
                    first, last = datetime.fromisoformat(start.replace("Z", "+00:00")), datetime.fromisoformat(end.replace("Z", "+00:00"))
                    if not first.tzinfo or not last.tzinfo or not 0 < (last - first).total_seconds() <= 63 * 86400:
                        raise ValueError("Select a calendar range of up to 63 days.")
                    return self.reply(200, desk.aggregate(get("account"), lambda email: desk.google.events(email, start, end)))
                if path == "/api/calendars" and not post:
                    return self.reply(200, desk.aggregate(get("account"), lambda email: [dict(c, account=email) for c in desk.google.calendars(email)]))
                if path == "/api/inbox" and not post:
                    result = desk.aggregate(get("account"), lambda email: desk.google.inbox(email, get("filter", "all"), get("unread") == "true"))
                    result["items"].sort(key=lambda x: int(x["date"]), reverse=True)
                    return self.reply(200, result)
                if path == "/api/labels" and not post:
                    return self.reply(200, {"items": desk.google.labels(get("account"))})
                if path == "/api/message" and not post:
                    return self.reply(200, desk.google.message(get("account"), get("id")))
                if path == "/api/notes" and not post:
                    notes = desk.keep.notes() if get("source") == "keep" else desk.state["notes"]
                    return self.reply(200, {"items": notes})
                if path == "/api/notes" and post:
                    if data.get("source") == "keep":
                        return self.reply(200, desk.keep.save_note(data))
                    with desk.lock:
                        note_id = str(data.get("id") or secrets.token_hex(12))
                        note = {"id": note_id, "title": str(data.get("title", ""))[:1000], "text": str(data.get("text", ""))[:100000],
                                "pinned": bool(data.get("pinned")), "source": "local", "updated": time.time()}
                        desk.state["notes"] = [n for n in desk.state["notes"] if n["id"] != note_id] + [note]
                        desk.save()
                    return self.reply(200, note)
                return self.reply(404, {"error": "Not found"})
            except (ValueError, GoogleError) as exc:
                return self.reply(400, {"error": str(exc)[:300]})
            except (BrokenPipeError, ConnectionResetError):
                return
            except Exception:
                return self.reply(500, {"error": "The companion could not complete this request. Check setup and try again."})
    return Handler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--data-dir", default=str(ROOT / "data"))
    parser.add_argument("--desktop-control-file")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    desk = Desk(args.data_dir, port=args.port)
    try:
        server = LocalServer(("127.0.0.1", desk.port), make_handler(desk))
    except OSError:
        print(f"Port {desk.port} is already in use. Close the other Google Desk companion, then start again.")
        return 1
    print(f"Google Desk is running locally on port {desk.port}.")
    print("Google data stays on this PC. Press Ctrl+C to stop.")
    desk.shutdown_callback = server.shutdown
    control = SecureStore(args.desktop_control_file) if args.desktop_control_file else None
    if control:
        control.save({"admin_key": desk.admin_key, "port": desk.port, "pid": os.getpid(), "version": "0.3.0"})
    if not args.no_browser:
        webbrowser.open(desk.setup_url())
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        if control and control.path.exists():
            control.path.unlink()
    return 0


if __name__ == "__main__":
    sys.exit(main())
