"""Small Google REST client, OAuth PKCE, and safe text-only email rendering."""
import base64
import hashlib
import json
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from email.header import decode_header, make_header
from html.parser import HTMLParser

SCOPES = "openid email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly"


class GoogleError(Exception):
    pass


def request_json(url, data=None, token=None, form=False):
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    if data is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded" if form else "application/json"
        data = urllib.parse.urlencode(data).encode() if form else json.dumps(data).encode()
    req = urllib.request.Request(url, data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        # Do not expose Google's raw response; it can contain account data.
        if exc.code in (400, 401):
            raise GoogleError("Google authorization expired or was rejected. Reconnect this account.") from None
        if exc.code == 403:
            raise GoogleError("Google denied access. Enable Gmail and Calendar APIs and check account permissions.") from None
        if exc.code == 429:
            raise GoogleError("Google is limiting requests. Try again shortly.") from None
        raise GoogleError("Google service returned HTTP " + str(exc.code)) from None
    except (urllib.error.URLError, TimeoutError):
        raise GoogleError("Cannot reach Google. Check your internet connection.") from None


class TextHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.hidden = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "head"):
            self.hidden += 1
        if tag in ("br", "p", "div", "li", "tr") and not self.hidden:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style", "head"):
            self.hidden = max(0, self.hidden - 1)

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def decode_body(value):
    try:
        return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4)).decode("utf-8", "replace")
    except (ValueError, TypeError):
        return ""


def message_body(payload):
    plain, rich = [], []
    def visit(part):
        if part.get("filename"):
            return
        data = part.get("body", {}).get("data")
        if data:
            if part.get("mimeType") == "text/plain":
                plain.append(decode_body(data))
            elif part.get("mimeType") == "text/html":
                rich.append(decode_body(data))
        for child in part.get("parts", []):
            visit(child)
    visit(payload)
    if plain:
        return "\n".join(plain)
    parser = TextHTML()
    parser.feed("\n".join(rich))
    return "".join(parser.parts).strip() or "This message has no readable text body. Open it in Gmail to view attachments."


def summarize(message, account):
    headers = {x["name"].lower(): x["value"] for x in message.get("payload", {}).get("headers", [])}
    def header(key):
        try:
            return str(make_header(decode_header(headers.get(key, ""))))
        except (LookupError, UnicodeError):
            return headers.get(key, "")
    return {"id": message["id"], "account": account, "subject": header("subject") or "(No subject)",
            "from": header("from"), "to": header("to"), "date": message.get("internalDate", "0"),
            "labels": message.get("labelIds", []), "snippet": message.get("snippet", "")}


class Google:
    def __init__(self, state, save, port):
        self.state, self.save, self.port = state, save, port
        self.pending, self.tokens, self.cache = {}, {}, {}
        self.lock = threading.RLock()

    def begin(self):
        client = self.state.get("client", {})
        if not client.get("client_id"):
            raise GoogleError("First import your Google Desktop OAuth client JSON in Settings.")
        state, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(64)
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
        self.pending[state] = (verifier, time.time())
        params = {"client_id": client["client_id"], "redirect_uri": self.redirect,
                  "response_type": "code", "scope": SCOPES, "state": state, "access_type": "offline",
                  "prompt": "consent select_account", "code_challenge": challenge, "code_challenge_method": "S256"}
        return "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode(params)

    @property
    def redirect(self):
        return f"http://127.0.0.1:{self.port}/oauth/callback"

    def callback(self, state, code):
        pending = self.pending.pop(state, None)
        if not pending or time.time() - pending[1] > 600:
            raise GoogleError("Sign-in session expired. Start Connect Google again.")
        client = self.state["client"]
        data = {"client_id": client["client_id"], "code": code, "code_verifier": pending[0],
                "redirect_uri": self.redirect, "grant_type": "authorization_code"}
        if client.get("client_secret"):
            data["client_secret"] = client["client_secret"]
        result = request_json("https://oauth2.googleapis.com/token", data, form=True)
        profile = request_json("https://www.googleapis.com/oauth2/v2/userinfo", token=result["access_token"])
        granted = set(result.get("scope", "").split())
        required = {"https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/calendar.readonly"}
        if not required.issubset(granted):
            raise GoogleError("Gmail and Calendar permissions are required. Reconnect and allow both.")
        email = profile["email"]
        with self.lock:
            previous = self.state.setdefault("accounts", {}).get(email, {})
            refresh = result.get("refresh_token", previous.get("refresh_token"))
            if not refresh:
                raise GoogleError("Google did not provide offline access. Reconnect with consent.")
            self.state["accounts"][email] = {"email": email, "refresh_token": refresh}
            self.tokens[email] = (result["access_token"], time.time() + result.get("expires_in", 3600))
            self.save()
            self.cache.clear()
        return email

    def token(self, email):
        with self.lock:
            if email not in self.state.get("accounts", {}):
                raise GoogleError("This Google account is not connected.")
            token, expires = self.tokens.get(email, (None, 0))
            if expires > time.time() + 60:
                return token
            data = {"client_id": self.state["client"]["client_id"], "grant_type": "refresh_token",
                    "refresh_token": self.state["accounts"][email]["refresh_token"]}
            if self.state["client"].get("client_secret"):
                data["client_secret"] = self.state["client"]["client_secret"]
            result = request_json("https://oauth2.googleapis.com/token", data, form=True)
            if result.get("refresh_token") and result["refresh_token"] != self.state["accounts"][email]["refresh_token"]:
                self.state["accounts"][email]["refresh_token"] = result["refresh_token"]
                self.save()
            self.tokens[email] = (result["access_token"], time.time() + result.get("expires_in", 3600))
            return result["access_token"]

    def get(self, email, path, params=None):
        url = "https://www.googleapis.com/" + path
        if params:
            url += "?" + urllib.parse.urlencode(params, doseq=True)
        return request_json(url, token=self.token(email))

    def cached(self, key, seconds, fetch):
        saved, value = self.cache.get(key, (0, None))
        if saved + seconds > time.time():
            return value
        value = fetch()
        self.cache[key] = (time.time(), value)
        return value

    def inbox(self, email, category="all", unread=False):
        q = "in:inbox"
        if category == "primary":
            q += " category:primary"
        if category == "no-promotions":
            q += " -category:promotions"
        if unread:
            q += " is:unread"
        def fetch():
            ids = self.get(email, "gmail/v1/users/me/messages", {"q": q, "maxResults": 24}).get("messages", [])
            def read(item):
                msg = self.get(email, "gmail/v1/users/me/messages/" + item["id"],
                               {"format": "metadata", "metadataHeaders": ["From", "Subject", "To"]})
                return summarize(msg, email)
            with ThreadPoolExecutor(max_workers=5) as pool:
                return sorted(pool.map(read, ids), key=lambda x: int(x["date"]), reverse=True)
        return self.cached((email, q), 45, fetch)

    def message(self, email, message_id):
        msg = self.get(email, "gmail/v1/users/me/messages/" + urllib.parse.quote(message_id, safe=""), {"format": "full"})
        return dict(summarize(msg, email), body=message_body(msg.get("payload", {})))

    def labels(self, email):
        return self.cached((email, "labels"), 300, lambda: self.get(email, "gmail/v1/users/me/labels").get("labels", []))

    def calendars(self, email):
        def fetch():
            result, page = [], None
            while True:
                params = {"maxResults": 250}
                if page:
                    params["pageToken"] = page
                data = self.get(email, "calendar/v3/users/me/calendarList", params)
                result.extend(data.get("items", []))
                page = data.get("nextPageToken")
                if not page:
                    return result
        return self.cached((email, "calendars"), 300, fetch)

    def events(self, email, start, end):
        def fetch():
            calendars = self.calendars(email)
            def read(calendar):
                result, page = [], None
                while True:
                    params = {"timeMin": start, "timeMax": end, "singleEvents": "true", "orderBy": "startTime", "maxResults": 250}
                    if page:
                        params["pageToken"] = page
                    data = self.get(email, "calendar/v3/calendars/" + urllib.parse.quote(calendar["id"], safe="") + "/events", params)
                    for event in data.get("items", []):
                        if event.get("status") == "cancelled" or any(a.get("self") and a.get("responseStatus") == "declined" for a in event.get("attendees", [])):
                            continue
                        result.append({"id": event["id"], "account": email, "calendarId": calendar["id"],
                                       "calendar": calendar.get("summary", "Calendar"), "color": calendar.get("backgroundColor", "#8ab4f8"),
                                       "title": event.get("summary", "Busy"), "start": event["start"], "end": event["end"],
                                       "link": event.get("hangoutLink", ""), "url": event.get("htmlLink", "")})
                    page = data.get("nextPageToken")
                    if not page:
                        return result
            with ThreadPoolExecutor(max_workers=4) as pool:
                return [event for group in pool.map(read, calendars) for event in group]
        return self.cached((email, "events", start, end), 60, fetch)
