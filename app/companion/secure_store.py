"""Windows DPAPI storage. Secrets never fall back to plaintext."""
import ctypes
import json
import os
from pathlib import Path
from ctypes import wintypes


class Blob(ctypes.Structure):
    _fields_ = [("size", wintypes.DWORD), ("data", ctypes.POINTER(ctypes.c_char))]


def crypt(data, decrypt=False):
    if os.name != "nt":
        raise RuntimeError("Protected storage requires Windows.")
    source = Blob(len(data), ctypes.cast(ctypes.create_string_buffer(data), ctypes.POINTER(ctypes.c_char)))
    target = Blob()
    dll = ctypes.windll.crypt32
    if decrypt:
        ok = dll.CryptUnprotectData(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target))
    else:
        ok = dll.CryptProtectData(ctypes.byref(source), "Google Desk", None, None, None, 1, ctypes.byref(target))
    if not ok:
        raise ctypes.WinError()
    try:
        return ctypes.string_at(target.data, target.size)
    finally:
        ctypes.windll.kernel32.LocalFree(target.data)


class SecureStore:
    def __init__(self, path):
        self.path = Path(path)

    def load(self):
        return json.loads(crypt(self.path.read_bytes(), True)) if self.path.exists() else {}

    def save(self, value):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".tmp")
        temporary.write_bytes(crypt(json.dumps(value).encode()))
        os.replace(temporary, self.path)
