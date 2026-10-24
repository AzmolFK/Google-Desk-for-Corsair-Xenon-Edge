# Google Desk 0.3.2 — dropdown inside the Inbox panel

Tapping **Primary** expands a custom list directly underneath it, inside the Inbox section, with a short opening/closing transition. Select **Primary**, **All inbox**, or **No Promotions**. Selection closes the list and updates the label. The list also closes when you tap outside it or press Escape.

This control is rendered in the widget itself. It does not use Windows' native dropdown popup, which could appear over Notes or on another monitor in iCUE. Opening the list makes room inside Inbox rather than covering neighboring panels. Short slots scroll the options if necessary. Reduced-motion settings disable the transition.

Keyboard support includes Enter/Space on the trigger, Up/Down, Home/End, and Escape. Unread still combines with any category.

## Update the installed widget

1. Quit Google Desk from the tray menu.
2. Copy this update into your existing app folder, replacing application files. **Keep your `data` and optional `.venv` folders.**
3. Open **Google Desk.exe**.
4. Choose **Install paired iCUE widget...** from its tray menu, then import the freshly generated **data/Google-Desk-Paired.icuewidget** into iCUE.
5. Re-add the updated Google Desk widget if iCUE does not refresh the existing instance.

Your saved Google connection and pairing key are reused. No new Google scopes or iCUE permissions are required. This replaces the always-visible filter buttons introduced in 0.3.1.

Browser checks use sample messages. The final touch behavior still needs checking on your physical XENEON EDGE.
