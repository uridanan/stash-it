# Stash — Save for later (Chrome extension)

A minimal Manifest V3 extension that saves the current tab (or any link) to your
[Stash](../README.md) reading list. Plain JavaScript, no build step.

## Install (load unpacked)

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked** and select this `extension/` directory.
4. Pin "Stash — Save for later" from the puzzle-piece menu for quick access.

## Configure

1. In the Stash web app, go to **Settings** (`/settings`) and create an
   **API token**. Copy it — it is shown only once and looks like `stash_<32 hex>`.
2. Right-click the extension icon → **Options** (or click **Options** inside the
   popup).
3. Set:
   - **Server URL** — where Stash is running (default `http://localhost:3000`).
   - **API token** — the token you just created.
4. Click **Test connection** to verify, then **Save**.

Settings are stored in `chrome.storage.sync`, so they follow your Chrome profile.

## Usage

- **Popup**: click the toolbar icon on any page, then **Save for later**.
  - New article → "Saved ✓" with the extracted title.
  - Already saved → "Already saved — moved to top" (Stash un-archives it and
    bumps it to the top of your list).
- **Context menu**: right-click anywhere on a page → **Save to Stash** saves the
  page; right-click a link → **Save to Stash** saves that link instead.
  The toolbar icon briefly shows a **✓** badge on success or **!** on failure.

## Troubleshooting

- **"No API token configured"** — open the options page and paste a token from
  the Stash **Settings** page.
- **"Invalid API token"** — the token was revoked or mistyped; create a new one.
- **"Could not reach …"** — check the Server URL and that the Stash server is
  running. Note the extension can talk to `http://localhost` / `http://127.0.0.1`
  and any `https://` host, but not other plain-`http` hosts.

## Files

- `manifest.json` — MV3 manifest.
- `popup.html` / `popup.js` — toolbar popup (save current tab).
- `options.html` / `options.js` — server URL + API token settings.
- `background.js` — service worker: context menu + badge feedback.
- `common.js` — shared settings/API helpers.
- `icons/` — generated PNG icons; regenerate with `node icons/generate.mjs`.
