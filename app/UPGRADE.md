# Google Desk 0.2 — simpler daily use

## Upgrade without losing your Google connection

1. Stop the old CMD helper once (Ctrl+C in its command window).
2. Extract the new ZIP. Copy the files from its **Google-Desk** folder into your **existing Google-Desk folder**, replacing application files. Keep your existing **data** folder and optional **.venv** folder. The ZIP does not contain or overwrite either folder.
3. Open **Google Desk.exe**. This replaces the daily CMD launcher. It starts the helper without a command window and adds an icon to the Windows notification area; it may be under the ^ arrow.
4. Right-click that icon and enable **Start with Windows** if you want automatic startup. This is optional and is not enabled merely by opening the app. Leave the application in this folder after enabling startup.
5. Import the updated **Google-Desk.icuewidget** into iCUE. It uses the same widget ID as the first version. If iCUE resets the pairing field, paste your existing key from Google Desk Settings again.
6. In iCUE, set **Text size (percent)** to **150** initially. An existing widget instance might retain an old setting; you can increase this to **200** if needed.

You should not need to import your OAuth client or sign in again just because you upgraded. Those are stored in your existing encrypted `data/desk.bin`. Using a completely new folder without that data file will look like a new installation.

## What changed

- **No daily command window.** Open the app from its executable or let Windows start it.
- **Tray controls.** Double-click the icon to open the dashboard. The menu offers Open Google Desk, Start with Windows, and Quit Google Desk. Opening the executable a second time opens the existing dashboard rather than starting another helper.
- **Saved connection.** Refresh tokens remain encrypted on disk and restore after restarts. The app automatically obtains fresh access tokens and saves replacement refresh tokens if Google returns one.
- **Larger text.** Default inbox sender text is approximately 27px, subject text 24px, email body 28.5px, and note text 24px in the larger layouts. Most of this was around 13–17px in the first build. The 100–200% control adjusts these sizes.
- **Less decoration.** Removed the small marketing labels, panel numbers and footer slogans to give useful content more space.

The tray app and a small Python helper still run while the widget syncs. You no longer need to keep a console open. Choosing Quit stops live data access until you open the app again. Python 3.12+ remains required; it is not bundled inside this launcher.

## Connect once rather than every week

The app already uses Google's offline-access refresh tokens, so routine application and Windows restarts do not require another Google sign-in.

If your Google Cloud project is **External / Testing**, Google's Gmail and Calendar authorizations expire after **seven days**. The app cannot override that rule.

For a personal project:

1. Open [Google Cloud Console](https://console.cloud.google.com/), select the same project, then **Google Auth Platform → Audience**.
2. Change the publishing status from **Testing** to **In production**. This changes your project's publishing configuration; review Google's displayed requirements yourself. It does not publish your widget to Corsair's Marketplace.
3. Reconnect Google once in the dashboard so it receives a new authorization.

Personal-use apps can qualify for Google's verification exception. Google may still show an unverified-app notice. Access can also be revoked later by the user or Google, so a literal never-sign-in-again guarantee is not possible.

Sources: [Google's Testing-mode expiry](https://support.google.com/cloud/answer/15549945), [personal-use verification exception](https://support.google.com/cloud/answer/13464323), [refreshing desktop-app access tokens](https://developers.google.com/identity/protocols/oauth2/native-app).

The widget's permission remains unchanged: **127.0.0.1, port 8765**. No new Google scopes are requested. Keep remains optional and experimental as described in SETUP.md.

## Checks

Eight offline tests passed, including restoring a saved Google connection after a simulated restart and saving a rotated refresh token. The native executable passed a hidden-launch test that starts the helper, reads its encrypted control file, checks its authenticated status and shuts it down. Browser checks cover all eight slot sizes and switching text size to 200%. Actual Google token expiry, Windows sign-in startup, and the final font size on your physical panel still need a real-world check.
