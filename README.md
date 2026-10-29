# Cane Permit Tracker

A mobile-first web app for the harvest-permit workflow: field scouts capture farmer and field details (with ID photos, GPS pin and signed undertaking), a data checker verifies and pushes to the ERP, a permit officer records the permit number, and the zoning/GIS officer confirms inspection, polygon receipt, zone, CBC and linear distance. Every user sees where each entry stands.

- `index.html` — the app. Hosted on GitHub Pages (or any static host).
- `Code.gs` — the backend, a Google Apps Script web app. Data is stored in a Google Sheet; photos and signatures in a Google Drive folder.

Users sign in with a username and password. Administrators add users with a temporary password, which must be changed at first sign-in, and can reset it, change roles or deactivate the account at any time.

## Setup

### 1. Backend (Google Apps Script) — about 10 minutes

1. Go to <https://script.google.com> with the Google account that should own the data (a shared company account is best), click **New project**, and name it *Cane Permit Tracker*.
2. Replace the contents of `Code.gs` in the editor with the `Code.gs` from this repository.
3. Near the top, change `ADMIN_USERNAME` and `ADMIN_TEMP_PASSWORD` to what you want for the first administrator account.
4. In the toolbar, select the function **setup** and click **Run**. Approve the permissions when asked (Sheets and Drive). The execution log shows the spreadsheet URL; the script also creates a Drive folder named *Cane Permit Tracker photos*.
5. Click **Deploy → New deployment**, choose type **Web app**, and set:
   - Description: anything
   - Execute as: **Me**
   - Who has access: **Anyone**
   Click **Deploy** and copy the **Web app URL** (it ends in `/exec`).

"Anyone" means anyone can reach the URL, not that anyone can read the data: every request still needs a valid sign-in token, and the sheet and photos stay private to the owning Google account.

### 2. Front end (GitHub Pages)

1. Open `index.html` and replace `PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE` (near the top of the script) with the Web app URL.
2. Push `index.html` to a GitHub repository (and this README and `Code.gs` for safekeeping).
3. In the repository, go to **Settings → Pages**, set the source to the branch (e.g. `main`, folder `/`), and save. The site address appears at the top of that page after a minute or two.
4. Open the site, sign in as the administrator with the temporary password, and choose your own password.

### 3. Add users and reference lists

- **Admin → Add a user**: full name, username, roles, and a temporary password (use *Generate*). The sign-in details are shown once; pass them to the person. They will be asked to set their own password the first time they sign in.
- **Admin → Users**: change roles, set a new temporary password if someone forgets theirs, deactivate or reactivate accounts.
- **Admin → Reference lists**: the CBC dropdown, and the suggestion lists for zones, areas and sublocations.

## Day to day

- Scouts work from the phone browser. *Add to Home Screen* makes it feel like an app.
- Each section has its own link, handy for sending to a team: `…/#capture`, `…/#check`, `…/#permits`, `…/#zoning`, `…/#board`, `…/#admin`.
- The data is in the Google Sheet created by setup (sheet *entries*); IT can open it directly when keying into the ERP. Do not edit rows there while the app is in use — use the app so the history stays correct.
- Admin can also download a CSV of all entries from the Admin tab.

## Updating

- To change the app: edit `index.html` and push. GitHub Pages updates within a minute or two.
- To change the backend: edit `Code.gs` in the Apps Script editor, then **Deploy → Manage deployments → ✎ Edit → Version: New version → Deploy**. The URL stays the same.

## Limits worth knowing

- Apps Script is comfortable with thousands of entries; each sync sends only what changed since the last one.
- Photos are resized on the phone (longest side 1000 px) before upload, roughly 100–200 KB each.
- The app needs a connection to submit. If a submission fails, the form keeps what was typed so it can be retried.
