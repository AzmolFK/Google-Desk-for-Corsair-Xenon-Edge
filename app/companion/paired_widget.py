"""Personalize a CLI-built widget template with this installation's local key."""
import json
import os
from pathlib import Path
import zipfile


def create_paired_widget(template, output, key):
    template, output = Path(template), Path(output)
    if not template.is_file():
        raise ValueError("The widget template is missing. Restore Google-Desk.icuewidget from the download.")
    if not isinstance(key, str) or len(key) < 32:
        raise ValueError("The local pairing key is invalid.")
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(".tmp")
    with zipfile.ZipFile(template) as source:
        names = source.namelist()
        if "pairing.js" not in names or "pairing.js" not in source.read("index.html").decode():
            raise ValueError("Update the app and widget template together before creating a paired widget.")
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_STORED) as target:
            for info in source.infolist():
                if info.is_dir() or Path(info.filename).is_absolute() or ".." in Path(info.filename).parts:
                    raise ValueError("Invalid widget template path.")
                payload = source.read(info.filename)
                if info.filename == "pairing.js":
                    payload = ("// Private local widget pairing. Do not publish this file.\nwindow.googleDeskPairingKey = " + json.dumps(key) + ";\n").encode()
                target.writestr(info, payload)
    os.replace(temporary, output)
    return output
