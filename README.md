# Dispatchio (v3.0)

## One-time setup (Windows)
1. Install Python 3 from python.org (tick "Add Python to PATH").
2. Put this folder on your Desktop (not in Program Files). Click the folder's address bar, type `cmd`, press Enter.
3. Build your call list: `python build_queue.py`
   The first run downloads two FMCSA files (the census, 1.3 GB, and the authority file) and can take 20 to 40 minutes.
   If the census.csv you already downloaded is in this folder, it is reused and only the authority file downloads.
4. In Chrome open `chrome://extensions`, turn on Developer mode, click "Load unpacked", pick the `extension` folder.
   (If you still have the old "Dispatch Dialer Assistant", reload it from the same folder or remove it first.)
5. Open voice.google.com and sign in. Click the Dispatchio icon to open the side panel, then "Load queue.json".

Refresh the data weekly: `python build_queue.py --refresh`, then load the new queue.json (history and saved carriers stay).

## Where the checks come from
- **MC authorized / carrier only**: FMCSA's current Motus authority file (updated daily). Only a currently ACTIVE
  common or contract authority passes. Brokers, carrier+broker companies, and freight forwarders are rejected.
- **General Freight, location, fleet size, phone, email, owner**: the Company Census File (updated daily).
- Both files can lag the live SAFER site by up to a day. "Open SAFER snapshot" in the panel shows live status, and the
  optional live FMCSA check in Settings re-verifies authority right before each dial.

## Live check (recommended)
Checks every carrier against FMCSA's live service the moment it appears, and skips it automatically if its authority
is not active, it also has broker authority, or General Freight is not ticked.
1. Go to https://mobile.fmcsa.dot.gov/QCDevsite/logingovInfo and create a developer account with Login.gov.
2. Log in, choose "My WebKeys", click "Get a new WebKey", fill out the form. The key is shown on screen. Copy it.
3. In Dispatchio open Settings, paste it into "FMCSA webKey", tick "Live FMCSA check on every carrier".
The line under the carrier name then says "Live check passed" (or why it was skipped). Keep the key private.

## Why MC numbers get skipped (and how to see it)
MC numbers are handed out one by one, but many were never granted, were withdrawn, belong to brokers, or lost authority
since. Those are not in your list on purpose. To see exactly why every MC in a range was kept or skipped, run:
`python build_queue.py --explain 1290000-1290300`

## Daily use, saved carriers, stats
See the in-panel labels. Dial is locked while you are on a call. Auto-dial is off by default. Called carriers can be
called again; only saved carriers (Lead, Sale, Follow-up, Do not call) are skipped. Stats are per block of 10,000 MCs and per pass.

## Dispatchio Assist (optional AI)
Assist shows facts it can work out locally (previous calls, saved status, stale or zero-truck records) and, if you add
an API key, a two-line brief plus a suggested opener, and a summary of your own notes.
1. Groq key (primary, free tier): https://console.groq.com/keys
2. OpenRouter key (fallback, free models only): https://openrouter.ai/keys
3. Settings > Dispatchio Assist: paste the keys, choose Off / On demand / Automatic, press "Test AI connection".
Model lists are fetched live from each provider, so retired models are skipped automatically. You can also pin a model.
Free limits: Groq is generous (about 30 requests a minute); OpenRouter free models are much tighter (tens per day
unless you add credit), so On demand is the default. Only public carrier facts and the notes you summarize are sent.

## Safety notes
- Auto-dial stays locked until Dispatchio has seen one complete call (dial, talk, hang up), proving it can detect calls.
- API keys are stored on this computer only and are never included in backups. Anyone with access to your Chrome
  profile could read them, so use free-tier keys.
- Settings > Data and backup: export or restore your history, saved carriers, notes and settings.
