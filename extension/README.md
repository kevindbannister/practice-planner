# XProFlow jobs (Chrome side panel)

A side panel on the right of Chrome with a thin icon rail: **Jobs**, **Timer**, **Notes**. On a Xero page it picks up the organisation name, finds the matching client in the planner and shows their open jobs, so you can start/stop the timer, hold or resume a job, mark records received, add time and add notes. It reads and writes the same SharePoint lists as the web app (PP Clients, PP Jobs, PP Services, PP Job Time).

## Install (once)
1. Chrome → `chrome://extensions` → turn on **Developer mode**.
2. **Load unpacked** → choose this `extension` folder.
3. Pin the icon. Clicking it opens the side panel.

## Allow sign-in (once, in Entra)
App registration (the planner's own) → Authentication → **Add a platform → Mobile and desktop applications** → custom redirect URI:

`https://gliilejbmomjkcffbcjbcmbblocjnlan.chromiumapp.org/`

(Not "Single-page application": Chrome extensions fail that type's origin check.) The panel's Account tab shows the same address.

## How the client is found
1. A Xero organisation you've already linked (remembered by its short code in the URL).
2. Otherwise the page title/organisation name is matched to client names (ignoring Ltd/Limited/&/and).
3. Otherwise **Change** lets you search; your choice is remembered for that Xero organisation.

No passwords or secrets are in the code; sign-in tokens live in `chrome.storage.local`. Run tests with `npm test`.

## Not yet tried against
Live Xero pages and the real Microsoft sign-in. The Xero page selectors are best guesses; the title match and manual search are the fallbacks.
