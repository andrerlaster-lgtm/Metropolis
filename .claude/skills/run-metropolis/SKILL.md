---
name: run-metropolis
description: Launch Pocket Metropolis locally in headless Chromium, get past the start menu, play through the first minute, open the 3D town and the military base, take desktop and phone screenshots and check the 3D views against performance budgets. Use when asked to run, view, or screenshot the app, to check a change works in the real game, and after any 3D change.
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

It takes about two minutes. For `desktop` and `phone` it writes `<device>-1-menu.png`,
`-2-born.png`, `-4-town3d.png` and `-5-base.png` (desktop also `-3-later.png`), and prints one
line per 3D view: draw calls, triangles and the median frame time, against the budget.

It exits **0** only when every step ran, there were no page or console errors and every budget
held. It exits **1** for an error, a step that failed or timed out (30 s each), a broken budget or
a view it couldn't measure, and **2** if the whole run hangs past 6 minutes. **Look at the
screenshots too**; a blank canvas can still pass.

## Budgets

`budgets.json` sets, for the 3D town and the military base on desktop and phone, the most draw
calls, triangles and frame milliseconds allowed. Draw calls and triangles fail the run. Frame time
only warns: the container draws with software GL, so it compares runs here but says little about a
real phone. The numbers are the measured baseline plus headroom (see the PR that set them); if a
change needs more, say so in its PR rather than raising them quietly. Pass another file as the
third argument to try different budgets.

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
- A fresh browser always gets the start menu first ("Start playing"), then the
  first-visit flow: a seed town from 1850 with the "Start a life" panel open.
  Saves live in localStorage, so every new browser context starts clean.
- The driver places a sandbag wall, a gun nest, a bunker and a mortar pit in the
  military base so every defence model is drawn and measured.
- Life events pause time until answered, so the town may grow less than
  you expect during the 3× wait.
- Wait for the text "Start a life", not the "Be born" button. Playwright
  doesn't count that button as visible until the click scrolls it into view.
