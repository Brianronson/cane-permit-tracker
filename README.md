# Cane Permit Tracker v2

Field capture → IT data check → ERP → permit and CCS clips → GIS zoning, with every user seeing where each entry stands.

- `index.html` — the app. Hosted on GitHub Pages (or any static host).
- `Code.gs` — the backend, a Google Apps Script web app. Data is stored in a Google Sheet; photos and signatures in a Google Drive folder.

## What is new in v2

| Area | Change |
|---|---|
| Data protection | The Data Protection Statement is shown from the sign-in page, the account menu and the capture form. The scout must tick that the farmer was informed and consents; the entry records the time and the statement version. Text and version are editable under **Admin → Settings & text**. |
| Field polygon | The pin is replaced by a field boundary drawn on a satellite map: tap the corners, add your GPS position corner by corner, auto-walk the boundary, or import a KML/GeoJSON. The app computes the acreage (acres and hectares), the centroid, the nearest CBC by linear distance and the transport zone (3 km bands A–F; beyond F is flagged for GIS). |
| Delivery CBC | Defaults to the nearest CBC; the scout can change it. The zone is always computed to the nearest CBC. |
| Harvester | Dropdown of active harvesters (seeded from the ERP partner list). **Admin → Harvesters** onboards new ones with name, ERP code, phone and ID, and can deactivate them. |
| Bank details | Bank name dropdown (seeded from the bank master) fills the bank code; account number is digits only with the bank's digit count enforced; account name and branch; photo of the bank card/passbook. |
| Permits | The permit officer records the permit number and the CCS clips issued. |
| Zoning | Zone, CBC and linear distance are pre-filled from the polygon; the GIS officer confirms the field was inspected and the polygon reviewed, corrects anything, and closes. |
| Admin | CBCs now carry coordinates; zone band width and letters are configurable; banks and harvesters are managed in-app; CSV export plus a GeoJSON export of all polygons. |

## Setup

### 1. Backend (Google Apps Script) — about 10 minutes

1. Go to <https://script.google.com> with the Google account that should own the data (a shared company account is best). Open your existing *Cane Permit Tracker* project, or click **New project** and name it.
2. Replace the whole contents of `Code.gs` in the editor with the `Code.gs` from this repository (select all, delete, paste). Save (Ctrl+S).
3. Near the top, set `ADMIN_USERNAME` and `ADMIN_TEMP_PASSWORD`.
4. In the toolbar, select the function **setup** and click **Run**. Approve the permissions when asked (Sheets and Drive). The execution log shows the spreadsheet URL and the photos folder. v2 creates a **new** spreadsheet (*Cane Permit Tracker v2*) and folder; a v1 spreadsheet, if you had one, is left untouched in Drive.
5. **Deploy → Manage deployments → ✎ Edit → Version: New version → Deploy** (or, for a new project, **Deploy → New deployment → Web app**, Execute as **Me**, Who has access **Anyone**). Copy the **Web app URL** (it ends in `/exec`).

"Anyone" means anyone can reach the URL, not that anyone can read the data: every request needs a valid sign-in token, and the sheet and photos stay private to the owning Google account.

### 2. Front end (GitHub Pages)

1. Open `index.html` and replace `PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE` (near the top of the script, `API_URL`) with the web app URL.
2. Commit `index.html`, `Code.gs` and this README to the repository (replace the v1 files). GitHub Pages republishes within a minute or two.
3. Open the site, sign in as the administrator with the temporary password, and choose your own password.

### 3. Check the reference lists

- **Admin → CBCs & zones**: the eight CBC points from the GIS coordinates sheet are pre-loaded. Confirm them, and set the band width (3 km) and zone letters (A–F).
- **Admin → Harvesters**: the 74 harvesters from the ERP partner list are pre-loaded (code, name). Add phone and ID as you have them.
- **Admin → Banks**: the 25 banks from the bank master with their account-number digit counts. Note the bank master lists National Bank four times with different digit counts — keep the ones the ERP actually accepts.
- **Admin → Settings & text**: the undertaking (terms) and the Data Protection Statement with their versions.
- **Admin → Users**: add scouts, checkers, permit officers and zoning staff with a temporary password (use *Generate*). The sign-in details are shown once.

## Day to day

- Scouts work from the phone browser; *Add to Home Screen* makes it feel like an app. The satellite map works best with mobile data on; the boundary can still be captured with GPS corners if tiles do not load.
- Capturing the boundary: tap **Tap corners** then tap each corner on the image, or stand at a corner and tap **Add GPS corner**, or tap **Auto-walk** and walk the boundary (a corner is added every ~8 m while the GPS fix is within 25 m). Drag a corner to adjust it; tap a corner to remove it.
- Each section has its own link: `…/#capture`, `…/#check`, `…/#permits`, `…/#zoning`, `…/#board`, `…/#admin`.
- The data is in the Google Sheet created by setup (sheet *entries*; polygons are stored as JSON in the `polygon` column, and also exportable as GeoJSON from Admin). IT can read the sheet directly when keying into the ERP; do not edit rows there while the app is in use.

## Updating

- To change the app: edit `index.html` and push.
- To change the backend: edit `Code.gs` in the Apps Script editor, then **Deploy → Manage deployments → ✎ Edit → Version: New version → Deploy**. The URL stays the same.

## Limits worth knowing

- Apps Script is comfortable with thousands of entries; each refresh fetches only entries changed since the last sync, and the page polls every 90 seconds while open.
- Photos are resized on the phone (longest side 1200 px) before upload, roughly 100–250 KB each; the bank card, two ID sides, farmer photo and signature are five uploads per entry.
- The app needs a connection to submit. If a submission fails, the form keeps what was typed so it can be retried.
- Account-number length is enforced as an exact match by default; switch to "up to the bank's digit count" under Settings if the ERP accepts shorter numbers.
