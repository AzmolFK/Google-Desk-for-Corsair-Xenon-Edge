# Google Desk for CORSAIR XENEON EDGE

A personal Windows/iCUE dashboard for Gmail, Google Calendar, meeting reminders and notes.

**Website and downloads:** https://azmolfk.github.io/Google-Desk-for-Corsair-Xenon-Edge/

## Latest version

0.3.2 — custom animated Inbox dropdown rendered inside the widget, automatic local pairing, a tray launcher, readable text and optional Keep integration.

- Download the complete app from the website.
- Windows, Python 3.12+ and iCUE 5.52+ are required.
- Keep your existing `data` folder when upgrading.
- Generate your private paired widget from the desktop tray menu; do not commit it.

## Repository structure

- `app/`: application, widget source, generic package, launcher source/executable, guides and offline tests.
- `docs/`: independent GitHub Pages website, privacy policy, terms and downloads.
- `docs/downloads/`: sanitized generic packages, older builds, guides and checksums.

For GitHub Pages, select **Deploy from a branch → main → /docs** in Settings → Pages.

## Privacy

Public files exclude runtime data, Google OAuth credentials, Keep master tokens, local notes and generated paired widgets. Google credentials are supplied only when configuring your own local installation. Keep's live adapter is optional and unofficial.

See [Privacy policy](https://azmolfk.github.io/Google-Desk-for-Corsair-Xenon-Edge/privacy.html) and [setup guide](app/SETUP.md).

## Development

`python -m unittest discover -s app/tests -v` runs the offline companion checks on Windows.

Package a modified widget using the official iCUE CLI: `icuewidget package app/widget -o app/Google-Desk.icuewidget`. Rebuild the Windows launcher from `app/desktop/Launcher.cs` using the .NET Framework C# compiler with Windows Forms, Drawing, Security and Web.Extensions references.

This is an independent personal project, not affiliated with Google, CORSAIR or Elgato.

