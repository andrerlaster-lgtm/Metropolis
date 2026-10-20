---
name: run-metropolis
description: Launch Pocket Metropolis locally in headless Chromium, play through the first minute (start a life, run at 3x), and take desktop and phone screenshots. Use when asked to run, view, or screenshot the app, or to check a change works in the real game.
---

# Run Pocket Metropolis

The live site (https://metropolis.lasterlab.app) is behind Vercel login, so don't
try to view it from a container. Build and run it locally instead.

## Steps

From the repo root:

```bash
node build.mjs
(cd dist && python3 -m http.server 8765 >/dev/null 2>&1 &)
timeout 10 bash -c 'until curl -sf localhost:8765/ >/dev/null; do sleep 0.5; done'
node .claude/skills/run-metropolis/drive.mjs <scratchpad>/shots
```

The driver writes `1-start.png`, `2-born.png`, `3-later.png` and `4-mobile.png`,
prints any page or console errors, and exits non-zero if there were any.
**Look at the screenshots**; a blank canvas means it failed to start.

To check one specific change, copy `drive.mjs` to the scratchpad and add the
clicks you need before a `page.screenshot(...)`.

Stop the server when done: `lsof -ti:8765 -sTCP:LISTEN | xargs -r kill`.

## Gotchas

- **Serve `dist/index.html`, not `dist/pocket-metropolis.html`.** The second
  file has no `<meta charset>`, so over a plain static server "×" and "·"
  show up as "Ã—" and "Â·". Vercel serves `index.html`, which is fine.
- Playwright isn't a repo dependency. The driver loads the container's
  global copy from `/opt/node22/lib/node_modules`, with Chromium in
  `/opt/pw-browsers`. Don't run `playwright install`.
- A fresh browser always gets the first-visit flow: a seed town from 1850
  with the "Start a life" panel open. Saves live in localStorage, so every
  new browser context starts clean.
- Life events pause time until answered, so the town may grow less than
  you expect during the 3× wait.
- Wait for the text "Start a life", not the "Be born" button. Playwright
  doesn't count that button as visible until the click scrolls it into view.
