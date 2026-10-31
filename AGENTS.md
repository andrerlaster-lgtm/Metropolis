# AGENTS.md: Pocket Metropolis

Instructions for AI coding agents (Codex and others). Pocket Metropolis lives at https://metropolis.lasterlab.app and in the GitHub repo `andrerlaster-lgtm/Metropolis`.

## What this is

Vanilla JavaScript game bundled by `build.mjs` into `dist/`.

## Commands

```
node build.mjs   # build to dist/
npm test         # node --test tests/*.test.mjs
```

Smoke test (headless browser, desktop and phone, 3D town and military base, performance budgets): see `.claude/skills/run-metropolis/SKILL.md`. Run it after any change you can see, and always after 3D changes.

## This app's specifics

- The repo is `Metropolis`. An older repo `30lilmickey-prog/pocket-metropolis` no longer deploys; don't push there.
- Save compatibility matters: don't change the saved-game shape without a migration and a test.

## 3D visual standards

The target is a painted, miniature-diorama look: warm, rustic, slightly cartoon. Keep new 3D work consistent with it.

- **Scale:** one map tile is one unit. A building stays inside its footprint; match the proportions of the people, vehicles and buildings already in the game.
- **Palette:** earthy and warm: plaster, stone, timber, terracotta and slate roofs, deep greens. Military kit is olive drab, sand and concrete. Team colours (lavender yours, coral theirs) only on soldiers and flags.
- **Geometry:** no bare boxes for buildings. Give them roofs, windows, doors, trim and depth. Prefer models from the Kenney kits through `tools/kit/` (one mesh, baked colours and ambient occlusion) over hand-placed boxes.
- **Materials:** `MeshStandardMaterial` for buildings, defences and soldiers (they pick up the environment light); the cheaper `MeshLambertMaterial` for the ground and large scenery, which cover most of the screen and cost the most on phones.
- **Lighting:** sun, sky light and the soft environment light in the military base; no post-processing effects (bloom, screen-space AO) without approval, because of phones.
- **Budgets:** a kit model stays under 1,500 triangles. Repeated scenery is merged or instanced. Keep within `.claude/skills/run-metropolis/budgets.json`, and if a change needs more, say so in the PR instead of raising the numbers quietly.

## Rules for any AI agent working here (Codex, Claude, or others)

1. **Deploys happen by pushing to GitHub.** A push to `main` on `andrerlaster-lgtm/Metropolis` deploys to https://metropolis.lasterlab.app automatically. Do NOT run `vercel deploy` or `vercel promote` by hand: the studio's Deploy Check can't verify hand deploys.
2. **Use a branch and a pull request.** Work on a new branch and open a pull request. Don't push to `main` unless the owner (Andre) asked you to. He merges.
3. **Keep the site private.** Login protection on every deployment must stay on. Never add public links, public aliases or shared preview links. Don't change Vercel project settings, domains or environment variables.
4. **No secrets in the repo.** Never commit `.env*`, tokens, API keys or passwords, and never print them. Andre adds keys in Vercel himself.
5. **No new AI features or paid APIs** without Andre's approval of the key and a spending cap.
6. **Test before asking for a merge.** Run the commands below and report what passed and what failed, honestly.
7. **Stay inside this app.** Don't edit other apps' folders or repos. If two apps need to share something, ask first.
8. **Keep notes current.** Update the README or project notes when behavior changes, and say what you didn't verify.
9. **After a merge,** check https://studio.lasterlab.app/deploys. This app should show Live. If it shows Failed or No deploy reported, find out why before doing anything else.
