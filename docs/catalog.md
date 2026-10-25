# Building catalog

Every kind of building the game can place: what it costs, when it unlocks, and what it does. The
numbers live in `src/config.js` (`STRUCTURES`, `COSTS`, `UPKEEP`, `BUSINESS_TAX`, `MILESTONES`,
`TOOL_GROUPS`) and `src/eras.js`; this page is the human-readable version. `tests/catalog.test.mjs`
checks the rules below.

## The table

"Unlocks" is the milestone that opens the tool in Milestones towns (Sandbox towns have everything).
"Era" is the era from which a town that grows by itself (yours with growth on, or the computer's) may
build it. Service entries read `kind radius (how many residents it looks after)`.

| Building | Menu | Cost | Upkeep / tax | Unlocks | Era | What it does |
|---|---|---|---|---|---|---|
| House | Homes | 150 | — | Hamlet (always) | Pioneer days | homes 4 |
| Cottage | Homes | 80 | — | Hamlet (always) | Pioneer days | homes 2 |
| Apartments | Homes | 600 | — | Village | Railway age | homes 10 |
| Tower | Homes | 1000 | — | Town | Modern times | homes 16 |
| Shop | Shops | 300 | tax 1.5/job | Hamlet (always) | Pioneer days | 5 jobs |
| Café | Shops | 200 | tax 1.5/job | Hamlet (always) | Pioneer days | 3 jobs, fun r3 |
| Mall | Shops | 2500 | tax 1.5/job | Town | Motor age | 24 jobs |
| Factory | Work | 1500 | tax 2.2/job | Village | Railway age | 20 jobs, smoke |
| Office | Work | 1200 | tax 2/job | Town | Motor age | 16 jobs |
| School | Services | 2000 | 30 | Village | Pioneer days | 4 jobs, school r7 (250) |
| Clinic | Services | 2500 | 35 | Town | Pioneer days | 4 jobs, health r7 (320) |
| Playground | Leisure | 400 | 5 | Village | Pioneer days | fun r4, green 0.5, walk-through |
| Sports field | Leisure | 1500 | 12 | City | Motor age | 2 jobs, fun r6, green 1, walk-through |
| Tree | Leisure | 10 | — | Hamlet (always) | — | green 1, walk-through |
| Park | Leisure | 100 | 2 | Hamlet (always) | Pioneer days | green 3, walk-through |
| Bakery | Shops | 180 | tax 1.5/job | Hamlet (always) | Pioneer days | 4 jobs |
| Library | Services | 900 | 12 | Village | Railway age | 3 jobs, school r5 (100) |
| Fire station | Services | 1800 | 25 | Village | Railway age | 6 jobs, fire r7 (280) |
| University | Services | 6000 | 60 | City | Modern times | 30 jobs, school r9 (450) |
| Bungalow | Homes | 100 | — | Hamlet (always) | Pioneer days | homes 3, green 0.3 |
| Row houses | Homes | 450 | — | Village | Railway age | homes 7 |
| Villa | Homes | 800 | — | Town | Motor age | homes 3, green 1 |
| Restaurant | Shops | 350 | tax 1.8/job | Village | Railway age | 8 jobs, fun r4 |
| Market | Shops | 250 | tax 1.2/job | Hamlet (always) | Pioneer days | 6 jobs, green 0.3 |
| Bank | Work | 1800 | tax 3/job | Town | Motor age | 12 jobs |
| Hotel | Work | 3000 | tax 2.4/job | Town | Motor age | 14 jobs, fun r3 |
| Warehouse | Work | 900 | tax 1.2/job | Village | Railway age | 14 jobs |
| Workshop | Work | 600 | tax 1.8/job | Village | Railway age | 9 jobs |
| Power plant | Work | 4000 | tax 2.5/job | City | Motor age | 18 jobs, smoke |
| Kindergarten | Services | 900 | 12 | Village | Railway age | 3 jobs, school r4 (90) |
| Museum | Services | 2200 | 20 | Town | Motor age | 6 jobs, school r6 (140) |
| Pharmacy | Services | 450 | 8 | Hamlet (always) | Pioneer days | 3 jobs, health r4 (110) |
| Hospital | Services | 8000 | 120 | City | Modern times | 30 jobs, health r10 (900) |
| Fire hut | Services | 600 | 8 | Hamlet (always) | Pioneer days | 2 jobs, fire r4 (90) |
| Fountain | Leisure | 300 | 3 | Village | Railway age | fun r3, green 1, walk-through |
| Community garden | Leisure | 120 | 2 | Hamlet (always) | Pioneer days | 1 jobs, green 2, walk-through |
| Swimming pool | Leisure | 1600 | 15 | Town | Motor age | 4 jobs, fun r5, green 0.3 |
| Cinema | Leisure | 2000 | tax 1.8/job | Town | Motor age | 8 jobs, fun r6 |
| Stadium | Leisure | 7000 | 45 | City | Modern times | 14 jobs, fun r10 |


## What every kind needs when you add one

A new kind is data first, art second. Go through this list (the catalog test fails if a step is missed):

1. `STRUCTURES` in `config.js`, **appended at the end** (share links store each kind by its position; there is room for 63).
2. `COSTS`, plus `UPKEEP` or `BUSINESS_TAX` (and a label in `CATEGORY_LABELS` in `economy.js`).
3. A milestone in `MILESTONES` (or none, for always available) and an era in `eras.js`.
4. A button in `TOOL_GROUPS` (the key is optional: only a few letters are free), an icon and tint in `ui.js` / `style.css`, a colour in `minimap.js`, a sound in `main.js`.
5. If it has jobs: a Life Story career in `lifeData.js`. If people go there: a venue entry in `townsfolk.js`.
6. If towns should build it by themselves: `growth.js` (`CAPS`, `PUBLIC`, and the places that choose what to build; the computer's towns use the same code).
7. Overhead art in `art2d.js`, and a storybook model in `view3d/storybookMore.js` (or `storybook.js`).

## How the new kinds fit what was already there

- **Homes** (bungalow, row houses, villa): the same rules as houses. They need a road in every mode (Phase 2). The villa adds greenery to its neighbours.
- **Services** use the existing coverage kinds (`school`, `health`, `fun`, `fire`), so they show in the Services view, the reach preview, service quality and the advisor with no new code. A hospital looks after 900 residents (a clinic 320), a kindergarten 90, a fire hut 90.
- **Workplaces** count in the labor market, taxes and Life Story careers like shops and offices. The power plant smokes like a factory; the workshop does not.
- **Open ground** (fountain, garden) can go on bare grass like a park and counts as greenery.
- **Towns that grow by themselves** choose among everything their era and milestones allow, so the computer's towns use the new kinds too.
- **The skill tree is unchanged.** Its effects are keyed to specific kinds (shops, factories, offices, malls); the new kinds simply aren't boosted yet. Ideas for that are listed in `docs/skill-tree.md`.

## Roadmap: farms and a basic resource system (planned, not built)

Farms matter, but they need something to feed, so they belong with a small resource system rather than
as another job building. The plan, so the catalog is ready for it:

1. **Resources:** three to start: food, goods and power. A resource is a per-day number on the town (`city.derived.resources`), produced by buildings and used by buildings and homes.
2. **Producers:** farms (food, needs open land and water nearby), workshops and factories (goods), power plants (power, with smoke). A market and a restaurant turn food into jobs and tax; a warehouse stores a surplus.
3. **Consumers:** homes eat (from the town's food), businesses use goods and power. A shortage shows as a resident thought and a small happiness penalty, never as a collapse.
4. **Where it plugs in:** `config.js` gets `produces` and `consumes` on a kind; `economy.js` or a new `resources.js` computes daily totals next to coverage; `advisor.js` and the City panel report them; `growth.js` builds farms when food is short. Nothing here changes saves: the numbers are derived each day.
5. **Farms:** a farm is open ground (walkable like a park, so it needs no road) with fields drawn in 2D and 3D; farmhouses are ordinary homes.

This is a plan only. No resource numbers exist in the game yet.

## Long-term: open world

Nothing in the catalog assumes a single fixed map size. Kinds are looked up by name and live in one
table, and the menu is built from `TOOL_GROUPS`, so a larger or streamed map only changes where tiles
come from, not what a kind is.
