# Google Desk 0.3 — automatic pairing on this PC

Your Google connection and local widget key are already permanent in the app's encrypted `data/desk.bin`. The earlier generic widget package required you to paste that key into each new widget instance. Version 0.3 can create a private, automatically paired package instead.

## One-time upgrade

1. Quit the previous helper from its tray menu (or stop the old CMD helper).
2. Copy this update into your **existing Google-Desk folder**, replacing application files. **Keep your existing `data` and optional `.venv` folders.** The download excludes them, so your Google credentials, notes and permanent key remain in place.
3. Open **Google Desk.exe**.
4. Right-click its Windows tray icon and choose **Install paired iCUE widget...**. You can also use **Settings → Install paired widget** in the desktop dashboard.
5. The helper creates **data/Google-Desk-Paired.icuewidget** and tries to open iCUE's import dialog. Complete the import. If the file association is unavailable, import this file yourself using iCUE's Widgets + button. **Use this paired file, rather than the generic Google-Desk.icuewidget template.**
6. Add as many instances of **Google Desk** as you need. They contain the same local pairing configuration, so leave the manual key field empty.
7. Enable **Start with Windows** in the tray menu once. Keep the app folder at that location.

## What happens after restarting the PC

- Windows starts the tray helper if you enabled startup.
- The helper loads your permanent local key and saved Google authorization.
- The widget waits for the helper and retries automatically as it starts.
- The existing Google refresh token renews access as needed. You are not asked to connect Google or paste a widget key on routine restarts.

Google can still require consent again if authorization is revoked or expires. In particular, an External Google Cloud project left in Testing has the seven-day authorization limit. Publishing eligibility and any required branding fields are controlled by Google.

## Keep the paired package private

The downloadable update has **no embedded account or pairing credentials**. The personal package is generated only on your PC. It contains the local widget access key, but does not contain Google OAuth refresh tokens, the OAuth client secret, email, calendar data, Keep tokens or notes.

Keep **Google-Desk-Paired.icuewidget** and your `data` folder private. Do not upload them to GitHub or send them to other people. You can share the generic template and source distribution instead.

The helper still requires an authenticated key on every data request. There is no public or unauthenticated automatic-pairing endpoint. The widget's manifest permission remains **127.0.0.1, port 8765**; no new Google scopes are requested.

## If it asks to connect again

- Check that the helper is running and that Windows startup is enabled.
- Check that you upgraded the existing app folder and kept `data/desk.bin`.
- Confirm that you imported **Google-Desk-Paired.icuewidget** from that helper's data folder.
- If you changed/deleted the app's data folder, generate and import a fresh paired package. Restoring a different Windows user's encrypted data is not supported.
- The manual pairing field remains an advanced fallback. Clear a stale manual override when using the paired package.

The one-time iCUE import permission dialog may still appear when installing a widget package. Automatic pairing removes the per-instance key entry; it does not bypass iCUE's own permissions.
