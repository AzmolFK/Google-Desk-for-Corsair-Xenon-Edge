# Google Desk — version 0.3

Gmail, Calendar, simple meeting reminders and notes for a CORSAIR XENEON EDGE.
This is a personal, local application. It is not affiliated with Google or CORSAIR.

For automatic pairing across new widget instances and PC restarts, follow **AUTOMATIC-PAIRING.md**. Create the private paired package on your PC once; no manual key entry is needed for instances of that package.

## Start here

1. Extract the whole Google-Desk folder from the ZIP. Keep its files together. For an existing installation, follow **UPGRADE.md** to preserve your saved Google connection.
2. You need Windows, Python 3.12 or newer, and iCUE 5.52 or newer.
3. Double-click **Google Desk.exe**. The local helper starts without a CMD window and opens the dashboard. Its Windows tray menu has **Start with Windows**, **Open Google Desk**, and **Quit Google Desk**. Automatic startup is optional.
4. You can use encrypted Local notes immediately. **Explore preview** shows sample emails and calendar events without connecting an account.
5. For live Google data, finish the Google setup below.
6. In the tray menu, choose **Install paired iCUE widget...**, then import the generated **data/Google-Desk-Paired.icuewidget** into iCUE and assign it to your XENEON EDGE.
7. The paired package includes this PC’s permanent local access key. New instances connect automatically. The manual key field is an advanced fallback; keep it empty when using the paired package. Keep the generated paired file private.
8. Approve the widget’s local connection permission for **127.0.0.1, port 8765**. The widget contacts only this local companion. The companion contacts Google when an account is connected.

The initial Google Cloud setup is required because this personal build has no shared developer OAuth credentials. Connecting Gmail in ChatGPT does not supply credentials that a separate Windows application can reuse.

## Connect Gmail and Calendar

All passwords and Google consent steps happen on Google’s website in your normal browser.

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create or select a project for your personal widget.
2. In **APIs & Services → Library**, enable **Gmail API** and **Google Calendar API**.
3. In **Google Auth Platform**, configure the app’s branding and audience. For a personal Gmail account choose **External**. If its publishing status is **Testing**, add your Gmail address as a test user.
4. Configure data access for `openid`, `email`, `https://www.googleapis.com/auth/gmail.readonly`, and `https://www.googleapis.com/auth/calendar.readonly`.
5. Create an OAuth client with application type **Desktop app**, then download its JSON file. A Web application client is not interchangeable with this build.
6. In Google Desk’s browser Settings, use **Import Google Desktop OAuth JSON**. The client is saved with Windows DPAPI encryption.
7. Click **Connect Google**, select your account, and grant Gmail and Calendar read access. The callback uses `http://127.0.0.1:8765/oauth/callback` with PKCE and a ten-minute, single-use state value.
8. Return to Google Desk and tap Refresh. You can repeat Connect Google to add another account.

Google may show an unverified-app warning for your own OAuth project. Complete consent yourself. Gmail read access is a restricted scope. Personal-use apps can qualify for a verification exception; public distribution has additional requirements.

In Testing mode, authorizations for these scopes expire after seven days. Reconnect when needed. Moving your project to In production avoids the Testing-mode seven-day rule, but does not remove verification requirements or guarantee that authorization will never be revoked.

**Read-only behavior:** Reading an email here does not mark it read in Gmail. Stars, importance and labels are displayed, not changed. No sending, deleting or archiving is implemented.

**Disconnect locally** removes this app’s stored account token and clears its cached account data. It does not revoke Google-side consent. You can also remove the app under your Google Account’s third-party connections.

## Google Keep — available options

### Option A: Import notes without a live adapter

1. Export Google Keep from [Google Takeout](https://takeout.google.com/).
2. Extract the downloaded ZIP.
3. In Google Desk’s browser Settings, find **Import existing Keep notes** and select the Keep note `.json` files. Select up to 500 at a time, with total request size below approximately 1 MB.
4. Imported titles, text, pin state and checklist text appear under **Local** notes. Identical imports are skipped. Imported checklists become editable text, with `[x]` and `[ ]` markers.

This is a one-time copy. Edits to these local copies do not change Google Keep. Images, audio, drawings and attachments are not imported.

### Option B: Experimental live Google Keep sync

The official Keep API is designed for enterprise administration and has no note-content update method. This optional adapter instead uses [gkeepapi](https://github.com/kiwiz/gkeepapi), an unofficial implementation of Keep’s private mobile API.

It supports this first version’s:

- Listing unarchived, non-trashed text and checklist notes.
- Creating text notes.
- Editing existing note titles and text.
- Editing text and checked state of existing checklist items.
- Pinning and unpinning notes.

It does **not** implement new checklist items, deletion, archive controls, images, drawings, attachments, labels or Keep reminders. These existing note properties are not intentionally overwritten by the editor.

1. Stop Google Desk before configuring Keep.
2. Double-click **Connect Keep.cmd**. It creates a `.venv` inside this folder and installs the optional pinned library. Internet access is needed for that installation.
3. Read the authentication explanation. If you choose to continue, type CONNECT and enter your account email and an **existing Keep master token** when prompted. Token input is hidden.
4. Follow the library’s [authentication documentation](https://gkeepapi.readthedocs.io/en/latest/#authenticating) to understand the token requirements. This app does not capture browser cookies, extract credentials, or implement the legacy username/password login flow.
5. The script validates the connection by reading notes and stores the token with Windows DPAPI encryption. It does not create or modify a note during setup.
6. Start Google Desk again, select **Google Keep** in Notes, and tap a note to edit it. **Save note** sends that change to Keep. The + button creates a new text note.

**This is not the normal scoped Gmail/Calendar OAuth connection. A Keep master token has broad account access. Do not paste passwords or tokens into chat, and only use a token for an account you control.** If you do not want that access model, use Option A and the Open Keep button instead.

The adapter may break when Google changes its private API. Live authentication and sync have not been tested against your account. Its data-model integration was checked with the actual library; network behavior remains unverified until you connect it. Simultaneous edits from another device can still conflict. If a save cannot be confirmed, refresh Keep before retrying to avoid duplicate notes.

To remove the local Keep connection, use **Disconnect Keep locally** in browser Settings. Removing local credentials does not revoke the underlying token at Google; manage account sessions separately if needed.

### Option C: Open native Keep in your browser

The arrow beside the Notes source selector opens [Google Keep](https://keep.google.com/) in your default browser. It does not embed Keep’s website inside the iCUE widget. This provides access to Keep features the panel does not yet implement.

## Layout and controls

- **XL horizontal (2536×696):** Calendar, inbox, email reader and notes together.
- **L horizontal (1688×696):** Three panels. Opening an email replaces the inbox with the reader; close the reader to return.
- **S/M and vertical layouts:** Tabs switch between panels, keeping text readable. Small horizontal is 840×344; medium horizontal is 840×696. Vertical sizes tested: 696×416, 696×840, 696×1688 and 696×2536.
- **Calendar:** Today, seven days and month; previous/next controls; tap a month date to show that day. Connected calendars, including shared and holiday calendars the account can access, are fetched with their calendar colors.
- **Reminder:** Displays the next timed event and its start time; highlights during the configured lead window. Dismiss clears that reminder. Opening Meet opens the link; Google may still require a join/admission step. Timed personal events can also appear as reminders. No call-progress tracking, live attendance, dimming or countdown is included.
- **Inbox:** Newest first, Primary/All inbox/No Promotions, and Unread filter. Up to 24 messages per connected account per filter are fetched in this first version. User labels, stars and importance markers are shown.
- **Email reader:** Text-only. Scripts, external images and remote tracking pixels are never rendered. Use Open in Gmail for rich formatting and attachments.
- **Settings:** Accent, charcoal/midnight background, panel order, refresh interval (default 60 seconds), reminder lead time (default 10 minutes), and text size (default 150%, adjustable to 200%). iCUE has text/accent/background colors, transparency, polling and reminder controls.
- **Offline:** Last successfully loaded data stays in memory while the panel is open, with an offline/error notice. The widget recovers on its polling interval. After a restart, Google data must be fetched again. Local notes persist encrypted on disk.

Calendar results are cached for 60 seconds, inbox results for 45 seconds, labels for five minutes and Keep reads for 30 seconds. Reminders update every 15 seconds using already-loaded event times. UI polling may be slower than the cache intervals. The reminder always loads the upcoming eight days even when browsing an older calendar month.

## Privacy, permissions and files

| Component | Access | Purpose |
|---|---|---|
| iCUE widget manifest | `url`, `127.0.0.1`, port `8765` | Connect only to the local companion |
| iCUE Link Provider | System browser links | Open Google sign-in, Meet, Gmail and Keep; no extra plugin permission is documented |
| Companion OAuth | Gmail read-only, Calendar read-only, account email | Show your inbox and calendars; account identity |
| Optional Keep adapter | Separate Keep master token | Read and save Keep notes using the private API |

The companion binds only to `127.0.0.1`. API requests require an unguessable bearer key. Account administration requires a separate session key, held in the browser’s memory and removed from the URL after launch. Reloading the browser tab drops that admin session; double-click the tray icon or open Google Desk.exe again to reopen the dashboard. Widget pairing survives companion restarts.

Credentials and local notes are stored in `data/desk.bin`, encrypted to the current Windows user with DPAPI. Keep that folder on this PC; another Windows user cannot normally decrypt it. No user credentials or data are included in the distributed ZIP. The native launcher writes only its own optional current-user startup entry when you enable Start with Windows. Its temporary control file, `data/desktop.bin`, is also protected with Windows DPAPI and removed at normal shutdown. The widget’s display preferences are stored locally; Google messages and calendar entries are not saved in browser storage. The local pairing key is included in the generated private widget package and can also be overridden in iCUE settings. It is not stored by the widget in browser storage. Never publish the generated package or data folder.

The companion uses HTTPS to Google services: `accounts.google.com`, `oauth2.googleapis.com`, `www.googleapis.com`. The optional gkeepapi dependency also contacts Google authentication/Keep endpoints such as `android.clients.google.com` and `keep.google.com`. The application has no telemetry, hosted database or third-party backend. Installing the optional dependency uses Python’s package registry.

## Validation and limitations

This is version **0.3.0**, with a native Windows tray launcher and private automatic-pairing packages. The executable is unsigned and uses your installed Python; it is not a Windows installer. See **UPGRADE.md** for the simpler daily flow and larger text.

- Corsair `icuewidget` CLI 0.5.1 validates the widget and generates the importable package.
- Nine offline companion tests cover auth boundaries, encrypted persistence, OAuth PKCE/state replay, safe email text, Takeout import and calendar-range validation.
- Browser layout checks cover all eight XENEON EDGE dimensions. Browser interactions verified month/week views, inbox filtering, preview note creation and saving a real encrypted local note through the companion.
- Keep text/checklist mapping was tested against gkeepapi 0.17.1. Real Google account authorization, live API responses, live Keep sync and physical XENEON EDGE touch behavior require your setup and hardware test.
- The tray launcher offers optional **Start with Windows** for the current user. It runs a local Python helper while the widget syncs. No administrator or Windows service installation is needed.
- The note editor includes a **Keyboard** button for an on-panel QWERTY keyboard, symbols, Shift, Space, Enter and Backspace. Physical XENEON EDGE touch behavior still needs a hardware test. A normal keyboard also works.

Run the offline tests from this folder:

```powershell
python -m unittest discover -s tests -v
```

For future widget edits, use the [official iCUE Widget CLI](https://docs.elgato.com/icue/widgets/):

```powershell
npm install -g icuewidget-cli
icuewidget validate widget
icuewidget package widget -o Google-Desk.icuewidget
```

Reference: [Google’s personal-use verification exception](https://support.google.com/cloud/answer/13464323), [Testing authorization lifetime](https://support.google.com/cloud/answer/15549945), [Google Keep API methods](https://developers.google.com/workspace/keep/api/reference/rest).
