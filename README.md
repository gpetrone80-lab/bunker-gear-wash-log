# Bunker Gear Wash Log

A simple installable web app that records **who washed bunker gear and when**, for secondary-exposure record keeping.

Each entry captures:

| Field | Example |
|---|---|
| Employee last name | Smith |
| Employee number | 10234 |
| Date the gear was washed | 2026-11-16 |

The server also stamps when the entry was logged.

## Features

- Entry password before anyone can log a wash
- Shared online record (Google Sheet) so every station and phone writes to one place
- Works on phones and PCs; "Add to Home Screen" installs it like an app
- Offline-safe: entries made without signal are kept on the device and uploaded automatically
- Admin PIN protects the **Records** tab, with search, **Download CSV** and **Download Excel (.xlsx)**
- Both passwords are checked on the server, never in the public site code

## How it works

```
Phone / PC  --HTTPS-->  Google Apps Script (checks password)  -->  Google Sheet (your record)
   ^ GitHub Pages hosts the web page only
```

See **[SETUP.md](SETUP.md)** for the 10-minute one-time setup.

## Files

- `index.html`, `css/`, `js/`: the web app (static, no build step)
- `apps-script/Code.gs`: the backend you paste into Google Apps Script
- `sw.js`, `manifest.webmanifest`, `icons/`: offline support and installability
