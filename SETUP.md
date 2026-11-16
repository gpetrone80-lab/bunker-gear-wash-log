# Setup (about 10 minutes, one time)

The website is hosted on GitHub Pages. The records are stored in **a Google Sheet that you own**. A small Google Apps Script sits in front of the Sheet and checks the passwords on the server, so nothing secret is ever in this public repository.

## 1. Create the Sheet and the script

1. Go to <https://sheets.google.com> and create a blank spreadsheet. Name it **Bunker Gear Wash Log**.
2. Menu **Extensions > Apps Script**.
3. Delete the sample code, paste in the whole contents of [`apps-script/Code.gs`](apps-script/Code.gs), and click **Save**.
4. In the function dropdown choose **setup**, click **Run**, and approve the permission prompt (it only touches this spreadsheet). A tab named **Wash Log** appears in the Sheet.

## 2. Set the two passwords

1. In Apps Script, click the gear icon, **Project Settings**.
2. Under **Script Properties** click **Edit script properties** and set:
   - `ENTRY_PASSWORD`: what crews type before logging a wash.
   - `ADMIN_PIN`: what only officers/admins use to view and download records.
3. Use two different values. Save. (Until you change them from `CHANGE-ME` the app refuses to work.)

## 3. Deploy as a web app

1. **Deploy > New deployment > Select type: Web app**.
2. Execute as: **Me**. Who has access: **Anyone**.
3. Click **Deploy**, approve permissions, and copy the **Web app URL** (ends in `/exec`).

"Anyone" only means the URL is reachable. Every request still needs the entry password (to add) or the admin PIN (to read). After 10 wrong guesses the role locks for 10 minutes.

## 4. Connect the website

1. Open `js/config.js` in this repository (on GitHub: click the file, then the pencil icon).
2. Paste the URL between the quotes: `APPS_SCRIPT_URL: "https://script.google.com/macros/s/.../exec"`.
3. Commit. The site updates within a minute or two.

## Changing things later

- **Change a password:** edit the Script Property. It takes effect immediately.
- **Edit or remove a wrong entry:** edit the row directly in the Google Sheet (the app does not delete records, to keep the record trustworthy).
- **Changed `Code.gs`?** Use **Deploy > Manage deployments > Edit > New version** so the same URL keeps working.
- **Backup:** File > Download in the Sheet, or use the app's Records tab (CSV or Excel).

## Privacy notes

- The repository and the website are public, but contain **no employee data and no passwords**.
- The data lives only in your Google Sheet. Do not share the Sheet beyond the people who should see it.
- The page asks search engines not to index it (`noindex`), but a public URL is still discoverable by anyone who has the link; the passwords are what protect it.
