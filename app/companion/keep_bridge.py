"""Optional unofficial Keep adapter. No password handling or token extraction."""
import threading
import time

SERVICE = "GoogleDesk.Keep"


class KeepBridge:
    def __init__(self, state):
        self.state = state
        self.client = None
        self.lock = threading.RLock()
        self.last_sync = 0

    def connect(self):
        email = self.state.get("keep_email")
        if not email:
            raise ValueError("Keep is not connected. Run Connect Keep.cmd to enable the experimental adapter.")
        try:
            import gkeepapi
        except ImportError:
            raise ValueError("Install the optional Keep adapter using Connect Keep.cmd.") from None
        if self.client is None:
            self.client = gkeepapi.Keep()
            try:
                self.client.authenticate(email, self.state["keep_token"])
            except Exception:
                self.client = None
                raise ValueError("Keep sign-in failed. Reconnect using Connect Keep.cmd.") from None
        return self.client

    @staticmethod
    def view(note):
        is_list = note.type.name == "List"
        return {"id": note.id, "title": note.title or "Untitled", "text": note.text,
                "pinned": note.pinned, "color": note.color.name, "source": "keep", "isList": is_list,
                "items": [{"id": item.id, "text": item.text, "checked": item.checked} for item in note.items] if is_list else []}

    def notes(self):
        with self.lock:
            client = self.connect()
            if time.time() - self.last_sync > 30:
                try:
                    client.sync()
                    self.last_sync = time.time()
                except Exception:
                    raise ValueError("Keep sync failed. Your existing notes have not been replaced.") from None
            return sorted([self.view(n) for n in client.all() if not n.trashed and not n.archived],
                          key=lambda n: not n["pinned"])

    def save_note(self, data):
        with self.lock:
            client = self.connect()
            try:
                # Pull before editing to reduce lost updates. List notes are edited as lists.
                client.sync()
                note = client.get(data["id"]) if data.get("id") else client.createNote()
                if note is None:
                    raise ValueError("Note no longer exists in Keep.")
                note.title = str(data.get("title", ""))[:1000]
                if note.type.name == "List":
                    changes = {x["id"]: x for x in data.get("items", [])}
                    for item in note.items:
                        if item.id in changes:
                            item.checked = bool(changes[item.id].get("checked"))
                            item.text = str(changes[item.id].get("text", item.text))[:20000]
                else:
                    note.text = str(data.get("text", ""))[:100000]
                note.pinned = bool(data.get("pinned", False))
                client.sync()
                self.last_sync = time.time()
                return self.view(note)
            except Exception:
                self.client = None
                raise ValueError("Keep could not confirm this save. Refresh Keep before retrying to avoid duplicates.") from None
