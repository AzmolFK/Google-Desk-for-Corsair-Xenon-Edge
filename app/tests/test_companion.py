"""Offline tests. No requests to Google and no account credentials required."""
import base64
import json
import os
from pathlib import Path
import shutil
import sys
import threading
import unittest
import urllib.error
import urllib.request
import zipfile
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "companion"))
from secure_store import SecureStore
from google_api import Google, GoogleError, message_body
from keep_bridge import KeepBridge
from server import Desk, make_handler
from http.server import ThreadingHTTPServer


class CompanionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.path = Path(os.environ.get("GOOGLE_DESK_TEST_DATA", str(ROOT / "test-data"))).resolve()
        cls.path.mkdir(parents=True, exist_ok=True)
        cls.desk = Desk(cls.path)
        cls.http = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(cls.desk))
        cls.desk.port = cls.http.server_port
        cls.thread = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()
        # Only files created by these tests; never recursively delete a computed directory.
        for name in ("desk.bin", "roundtrip.bin", "Google-Desk-Paired.icuewidget"):
            file = cls.path / name
            if file.exists():
                file.unlink()
        cls.path.rmdir()

    def call(self, path, data=None, role="admin", host=None):
        key = self.desk.admin_key if role == "admin" else self.desk.state["widget_key"] if role == "widget" else "bad-key"
        headers = {"Authorization": "Bearer " + key}
        if host:
            headers["Host"] = host
        payload = None
        if data is not None:
            payload = json.dumps(data).encode()
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(f"http://127.0.0.1:{self.http.server_port}" + path, data=payload, headers=headers)
        try:
            with urllib.request.urlopen(request) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            return error.code, json.load(error)

    def test_authentication_and_host_boundary(self):
        self.assertEqual(self.call("/api/status", role="invalid")[0], 401)
        self.assertEqual(self.call("/api/status", host="attacker.example")[0], 403)
        self.assertEqual(self.call("/api/client", {"client_id": "x.apps.googleusercontent.com"}, role="widget")[0], 403)
        self.assertIsNone(self.call("/api/status", role="widget")[1]["widgetKey"])

    def test_encrypted_notes_survive_restart(self):
        code, note = self.call("/api/notes", {"title": "Private note", "text": "never-plaintext-472", "pinned": True}, role="widget")
        self.assertEqual(code, 200)
        self.assertNotIn(b"never-plaintext-472", (self.path / "desk.bin").read_bytes())
        reloaded = Desk(self.path)
        self.assertTrue(any(n["id"] == note["id"] and n["text"] == "never-plaintext-472" for n in reloaded.state["notes"]))
        self.assertEqual(self.call("/api/notes", {**note, "text": "Updated"})[1]["text"], "Updated")

    def test_dpapi_round_trip(self):
        store = SecureStore(self.path / "roundtrip.bin")
        store.save({"token": "secret-token", "unicode": "café"})
        self.assertNotIn(b"secret-token", store.path.read_bytes())
        self.assertEqual(store.load()["unicode"], "café")

    def test_permanent_pairing_survives_restart_and_new_packages(self):
        before = self.desk.state["widget_key"]
        self.assertEqual(self.call("/api/widget/install", {"open": False}, role="widget")[0], 403)
        self.assertEqual(self.call("/api/widget/install", {"open": False}, role="invalid")[0], 401)
        code, result = self.call("/api/widget/install", {"open": False})
        self.assertEqual(code, 200)
        self.assertFalse(result["opened"])
        package = self.path / "Google-Desk-Paired.icuewidget"
        with zipfile.ZipFile(package) as archive:
            pairing = archive.read("pairing.js").decode()
            self.assertIn(before, pairing)
            self.assertIn('src="pairing.js"', archive.read("index.html").decode())
            self.assertFalse(any(".bin" in name or "data/" in name for name in archive.namelist()))
        restarted = Desk(self.path)
        self.assertEqual(restarted.state["widget_key"], before)
        self.assertEqual(self.call("/api/widget/install", {"open": False})[0], 200)
        with zipfile.ZipFile(package) as archive:
            self.assertEqual(archive.read("pairing.js").decode(), pairing)
        with zipfile.ZipFile(ROOT / "Google-Desk.icuewidget") as archive:
            self.assertNotIn(before, archive.read("pairing.js").decode())
        # The public static script never exposes the installation's key.
        with urllib.request.urlopen(f"http://127.0.0.1:{self.http.server_port}/pairing.js") as response:
            self.assertNotIn(before.encode(), response.read())

    def test_saved_google_connection_refreshes_after_restart(self):
        email = "remembered@example.com"
        with self.desk.lock:
            self.desk.state["client"] = {"client_id": "test.apps.googleusercontent.com"}
            self.desk.state["accounts"][email] = {"email": email, "refresh_token": "saved-refresh"}
            self.desk.save()
        restarted = Desk(self.path)
        with patch("google_api.request_json", return_value={"access_token": "fresh-access", "expires_in": 3600, "refresh_token": "rotated-refresh"}) as request:
            self.assertEqual(restarted.google.token(email), "fresh-access")
            self.assertEqual(request.call_args.args[1]["grant_type"], "refresh_token")
            self.assertEqual(request.call_args.args[1]["refresh_token"], "saved-refresh")
            self.assertEqual(restarted.google.token(email), "fresh-access")
            self.assertEqual(request.call_count, 1)
        self.assertEqual(Desk(self.path).state["accounts"][email]["refresh_token"], "rotated-refresh")
        self.desk.state["accounts"].pop(email, None)
        self.desk.save()

    def test_takeout_import_and_deduplication(self):
        item = {"title": "Imported", "listContent": [{"text": "Buy milk", "isChecked": True}]}
        self.assertEqual(self.call("/api/notes/import", {"notes": [item]})[1]["imported"], 1)
        self.assertEqual(self.call("/api/notes/import", {"notes": [item]})[1]["imported"], 0)
        self.assertTrue(any(n["text"] == "[x] Buy milk" for n in self.call("/api/notes")[1]["items"]))
        self.assertEqual(self.call("/api/notes/import", {"notes": [{"wrong": True}]})[0], 400)

    def test_oauth_pkce_and_state_replay(self):
        self.desk.state["client"] = {"client_id": "test.apps.googleusercontent.com"}
        google = self.desk.google
        from urllib.parse import urlsplit, parse_qs
        query = parse_qs(urlsplit(google.begin()).query)
        self.assertEqual(query["code_challenge_method"], ["S256"])
        state = query["state"][0]
        scope = "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly"
        results = [{"access_token": "access", "refresh_token": "refresh", "scope": scope}, {"email": "test@example.com"}]
        with patch("google_api.request_json", side_effect=results) as mocked:
            self.assertEqual(google.callback(state, "code"), "test@example.com")
            self.assertIn("code_verifier", mocked.call_args_list[0].args[1])
        with self.assertRaises(GoogleError):
            google.callback(state, "code")
        self.desk.state["accounts"].clear()

    def test_email_html_is_text_only_and_attachments_ignored(self):
        def encoded(value):
            return base64.urlsafe_b64encode(value.encode()).decode().rstrip("=")
        payload = {"parts": [{"mimeType": "text/html", "body": {"data": encoded('<p>Hello <b>friend</b></p><script>steal()</script><img src="https://tracker.example">')}},
                              {"filename": "secret.txt", "mimeType": "text/plain", "body": {"data": encoded("ATTACHMENT")}}]}
        body = message_body(payload)
        self.assertIn("Hello friend", body)
        self.assertNotIn("steal", body)
        self.assertNotIn("ATTACHMENT", body)
        self.assertNotIn("tracker", body)

    def test_bad_calendar_range_rejected(self):
        self.assertEqual(self.call("/api/events?start=2026-01-01T00:00:00Z&end=2027-01-01T00:00:00Z")[0], 400)


if __name__ == "__main__":
    unittest.main()
