# Reference: a 3D battle mode (defend your town, attack a computer town)

- **Goal:** a dedicated 3D battle mode in the spirit of GUNS UP!: you build defences at home and send troops against another town. You can defend your own town from a computer-run town, or attack one. GUNS UP! is a commercial game. It's the inspiration for the style and nothing else: no name, art, units, maps or interface come from it.
- **Projects read (most useful first):**

  | Project | What it is | Read at | Licence |
  | --- | --- | --- | --- |
  | [djpav/threejs-tower-defense](https://github.com/djpav/threejs-tower-defense) | Three.js + TypeScript tower defence: 7 towers, 9 enemy types, 10 levels plus endless, flow-field maps, adaptive difficulty | `dcb33e1` (2026-03-15): `docs/` (architecture, features, balance, todo), `src/map`, `src/systems`, `src/entities`, `src/configs`, `src/rendering`, `src/ui` | MIT, © 2026 Djordje Pavlovic |
  | [atxgreene/Ugh-Guys-](https://github.com/atxgreene/Ugh-Guys-) ("Shadow of the Watchers") | Three.js real-time strategy game: three factions, economy, fog of war, an AI that attacks in waves, seeded replays | `3641c8b` (2026-07-04): README, `src/pathfinding.js`, `src/ai.js`, combat, movement and building parts of `src/game.js`, `landing/img/README.md`, `ART_DIRECTION.md` | CC0 1.0 (public domain) for the code; see the asset notes below |
  | [cola-runner/frostmarch](https://github.com/cola-runner/frostmarch) | Small Three.js + React fantasy strategy demo with a phone-friendly battle UI | `9e2bcbb` (2026-09-06): README, `CREDITS.md`, `game/simulation.ts`, `tests/battle.test.mjs` | MIT, © 2026 Frostmarch contributors |
  | [Casmo/tower-defense](https://github.com/Casmo/tower-defense) | 2014 Three.js tower defence where towers block tiles and enemies re-route | last commit 2024-08-07: README, `CONTRIBUTE.md`, `Worker.PathFinder.js`, tower classes | MIT, © 2014 Mathieu; bundles other people's libraries and unattributed assets |

- **How we use them:** as patterns we rewrite in our own plain JavaScript. Everything below is our own summary and design. MIT and CC0 would allow copying code. If we ever paste a snippet from an MIT project, its copyright line and licence go with it (into a `THIRD_PARTY.md` and the file header). CC0 needs no notice, but we credit it anyway. Assets are a separate question: see "Licences and asset rights".
- **Why it's here:** our own requirement is the part none of these games have. A battle has to be fought over a real town in our world, by its real owner, paid from its real budget, and the damage has to stay afterwards. All four projects run self-contained levels that start fresh each time.

## What we already have (don't rebuild these)

| Need | Already in Pocket Metropolis |
| --- | --- |
| Towns with an owner | `world.js`: every town has an owner (`player` or `cpu`), its own money and its own simulation; `worldUI.js` has owner colours and the world map |
| A computer opponent that plays by the rules | `cpuPlanner.js`: pays the player's prices from its own budget, keeps a reserve, saves up for goals, weighs choices against what it can afford |
| Building damage and repair | `disasters.js`: `structure.damage` 0..1 (a third or more halves what a home holds), rubble at full damage, broken roads, repair crews, "repair everything", "prepare" halves damage, fire cover from fire stations |
| A warning before trouble arrives | `disasters.js` warns a few hours ahead and offers a choice to prepare |
| Fire and smoke in 3D | `view3d/effects3d.js`: instanced flames and soot, a flickering fire light |
| Crowds drawn cheaply | `view3d/agents3d.js`: everyone in town is drawn with instanced meshes, with picking |
| Pathfinding | `labor.js` (typed-array heap Dijkstra), `sidewalks.js` (the walking network), `roadPlanner.js` |
| Cameras | `view3d/rig.js`: orbit, street level and follow |
| Several towns in one 3D world | `view3d/view3d.js` `setWorld`: towns placed side by side with countryside between |
| Fixed steps and game speed | `simulation.js`: `SIM_STEP` 0.25, speed 0–3 |
| Era and milestone gating | `eras.js`, `milestones.js`, `growth.allowed()` |
| Saves | `persistence.js`: versioned saves with migrations; the world rides inside the player's save |
| Research already written up | [openage.md](openage.md): ownership and stances (1), a scheduled event queue (2), flow fields (6), military stances (10), AI players (11). Not repeated here. |

## The most reusable ideas, ranked

### 1. A battle is a rules module with no screen in it
All three modern projects keep their rules apart from drawing. frostmarch's whole battle is one class with `step(dt)` and `snapshot()` and no DOM or renderer. Its Node tests step it at a fixed 0.05 s and check money, queues and positions. djpav runs its systems in a fixed order every frame: waves, then enemies move, then towers pick targets, then projectiles fly, then impacts and effects resolve.

*For us:* a `battle.js` built from the two real towns, `new Battle({ attacker, defender, seed })`, with `step()` on our fixed step, `snapshot()` for the screen and the tests, and a fixed system order (deploy → move → defences aim → projectiles → impacts). It never touches Three.js. The 3D view reads the snapshot, the same way it already reads the city. Tests live in `tests/battle.test.mjs`, like `world.test.mjs`.

### 2. Battle state is the town's real state (our own requirement)
None of the four projects do this, so it's our design:
- **Battlefield:** the defender's actual tile map, plus a strip of countryside along one edge for the attacker to deploy from. Buildings on the field are the real structures.
- **Damage stays:** a hit on a building raises its `structure.damage`, so it shows up afterwards as damage or rubble, and the existing repair crews and "repair everything" fix it. One `applyResult()` writes everything back: damage, money spent, troops lost, and any money taken.
- **Military strength:** saved per town in `city.systems.military`: troops by type, defences (which are structures in `STRUCTURES`), and a supply cap from barracks (a "contingent", openage idea 7). Troops and defences cost money from that town's own budget, and its era and milestones decide what it may build.
- **Ownership:** a battle has an attacker and a defender taken from `world.js` owners. It never changes who owns a town.
- **Shape change:** this adds to the save, so it needs a migration and a test (AGENTS.md).

### 3. One flow field moves every troop (djpav `DistanceField`; openage idea 6)
djpav runs a breadth-first search outward from the goal. Each cell stores how many steps it is from the goal, and an enemy simply steps to its lowest neighbour. One search serves every enemy, and a blocked spawn shows up as "unreachable". Their map builder refuses a map with no route from spawn to goal. Casmo checks each blocking tower before building it: it runs A* (in a Web Worker) on a copy of the grid with that tile closed, builds only if a route remains, then re-routes every enemy.

*For us:* one field per target (the town hall, or whichever defence the squad is after), built with the heap we already have in `labor.js`, so it's Dijkstra with costs rather than plain steps:
- roads cost the least, open ground and parks a bit more, rubble a bit more again;
- buildings can't be crossed;
- walls get a high but finite cost, so when the way round is long the field leads through a wall and troops stop to break it. That's our own idea: no special "breach" code and no "you sealed the town" rule needed.

Rebuild the field only when the map changes (a building falls, a wall is placed). Our towns are at most 128 × 128, so one rebuild is cheap.

### 4. A danger map for choosing routes (djpav `InfluenceMap`)
Each tower adds danger to the cells around it, strongest at the tower and fading to nothing at the edge of its range, scaled by its damage. Their comment says it's meant for enemies to score routes by distance plus danger. At this commit it's rebuilt whenever a tower changes, but nothing reads it yet.

*For us:* actually use it.
- **Attacking:** add danger × a weight to the flow-field cost, so a computer attack flows round strong defences, and pick the deploy edge with the least danger.
- **Defending:** the computer town places its next defence where the expected route has the least cover.

It's the same kind of layer as our desirability maps.

### 5. Defences pick a target every step (djpav `CombatSystem`)
Each tower re-checks every enemy in range every frame, with no cached target, using squared distances. Its targeting mode decides who it shoots:
- **first:** furthest along the path;
- **nearest**;
- **strongest:** most health;
- **weakest:** least health.

Flags such as "can't hit flying" are plain data. A tower fires when its cooldown (1 ÷ fire rate) runs out. Pulse towers hit everyone in range at once, with no projectile.

*For us:* the same, with "first" meaning the lowest flow-field value (closest to the target). The mode is a setting on each defence that the player can change in the inspector.

### 6. Troops choose targets by what matters, not just what's close (Ugh-Guys `acquireTarget`)
A unit scores everything in range:
- closer is better (that's the baseline);
- a big bonus for targets it counters;
- a bonus for finishing off the wounded;
- real threats rank above workers, and buildings come last.

Player units and the AI share this one function, so smarter targeting helps both.

*For us:* troops go after defences that are shooting them, then walls in their way, then their objective. Whether homes are ever targets is a decision for Andre (see the questions at the end).

### 7. Damage, counters and balance as data and tests (Ugh-Guys `applyHit`; djpav `BALANCE.md`)
- **Ugh-Guys damage:** multiply the base damage by a bonus for each of the target's tags (infantry, vehicle, structure and so on), then subtract armour, and never deal less than 1. Units and buildings are plain data with stats and tags.
- **djpav balance:** a written-down model. Damage per second is damage × fire rate. Chain hits add a sum of fall-offs, splash damage scales with crowd size, and towers are compared by damage per second for each coin spent. It runs as a tool and in tests.

*For us:* troop and defence types are data next to `STRUCTURES` in `config.js` (openage idea 5: units built from abilities). A Node test keeps every type's damage per cost inside a band, so a new troop can't quietly break the balance.

### 8. Two kinds of projectile, one impact rule (djpav `Projectile` and `ImpactHandler`; Ugh-Guys projectiles)
- **Homing (djpav):** flies at the target's current position. If the target dies on the way, it carries on to the last place it saw it, and lands when the remaining distance is within one step.
- **Arcing (Ugh-Guys):** a fixed flight time based on distance, a straight line with a rising-and-falling height added on top, following the target until it lands. Good for mortars and artillery.
- **Impacts (djpav):** resolved in a fixed order (direct damage, then slowing effects, then splash). Splash uses the landing point, so it still hits a crowd even if the first target died mid-flight.

*For us:* the same rules in `battle.js`. In 3D, draw every projectile with one instanced mesh, as we already do for people. Ugh-Guys makes a new mesh for each shot and each trail puff, which is the part not to copy. djpav reuses projectiles from an object pool.

### 9. The computer's attacks: mass, push, retreat, defend (Ugh-Guys `AI`)
It thinks every 0.8 s, not every frame. Its attacks follow a small cycle:
- **Massing:** troops gather at a staging point about 28% of the way to the enemy.
- **Attack:** once enough are free, it commits most of them (85%) as one group.
- **Pressing on:** the group keeps going for the freshest target.
- **Retreat:** survivors pull back to regroup once the group falls below a set share of its starting size, rather than trickling in one by one.
- **Defending:** if something near its home base is hit, it calls the army back for a few seconds.

A difficulty table sets wave sizes, timing and when to retreat. When training, it leans towards troops that counter the opponent's army (it counts the tags the enemy has). djpav adds adaptive difficulty: waves grow a little each time and ease off when the player loses lives, kept between 0.7× and 1.8×.

*For us:* two layers.
- **Strategy, in `cpuPlanner.js` on its slow look:**
  - decide how much of the budget goes on defences and troops, within the reserve and saving-goal rules it already has;
  - decide to attack only when its strength is clearly ahead, a cooldown has passed and the target isn't under protection.

  An attack is announced hours ahead as a scheduled event (openage idea 2), with a "prepare" choice like the disaster warnings.
- **Tactics, inside the battle:** the massing / attacking / retreating cycle and the counters above.

A per-town conflict setting (off, gentle, fierce) works like the disaster level setting. Adaptive easing keeps it from snowballing over a struggling player.

### 10. Moving groups without clumping (Ugh-Guys `formationMove`, `seek`, `unitsNear`, stances and leashes)
- **Formations:** facing from the group's centre towards the destination; melee in front, support in the middle, ranged at the back; a front a little wider than it is deep (columns ≈ 1.4 × √n), with spacing from the largest unit.
- **Getting stuck:** judged by real progress towards the goal, not by speed, with an escalating response:
  1. re-plan the route;
  2. side-step;
  3. settle near the goal when crowded;
  4. give up.
- **Spatial hash:** "who's near me" questions use a grid of cells rebuilt each step.
- **A* rules:** A* never cuts corners, and paths are straightened wherever there's a clear line of sight.
- **Stances:** hold, defensive and aggressive, with an anchor point.
- **Guard posts:** guards chase intruders up to a leash distance, then walk home.

*For us:*
- the flow field (idea 3) moves the crowd;
- A* with straightening is only for a single "send this squad there" order;
- a garrison defending our own town uses the leash idea, so defenders don't wander off across the countryside.

### 11. Battle screen habits worth copying (frostmarch, djpav, Ugh-Guys)
- **Pause while planning (frostmarch):** the battle pauses while the recruit panel, help or a targeting preview is open, and resumes when the last one closes.
- **One "why not" check (frostmarch):** a single function returns the reason a placement or ability isn't allowed. It drives both the live preview and the refusal, and previewing or cancelling costs nothing. Our build tools already preview this way, so match them.
- **Paying and waiting:** troops are paid for once, when queued, and appear after a training time; there's a cap on the queue. Defences take a few seconds to build.
- **See it coming:** a preview of the next wave before it arrives (djpav). For us that's the warning hours ahead.
- **Speed controls:** pause, 1×, 2× and 4×. We have pause to 3×.
- **Under-attack alert:** shown at most every 12 seconds, with a "jump there" button (Ugh-Guys).
- **Damage that shows (Ugh-Guys):** a building leans and gets scorch marks at two-thirds health and catches fire below a third. For us, read the stage from `structure.damage` and reuse our existing flames.
- **Touch:** 44–48 px touch targets, safe-area insets, tap, drag and pinch kept apart (frostmarch, djpav). Our phone layout already follows this.

### 12. Same seed, same battle (Ugh-Guys replays; djpav seeded maps)
Ugh-Guys draws every random number from a generator seeded from the map, numbers its units the same way each match, times things in game time rather than real time, records each player command with the step it happened on, and checks a checksum of the state every 120 steps to catch replays drifting apart.

*For us:*
- a seeded random generator per battle, so tests and auto-resolve are repeatable;
- the save keeps only the result and a short log (who attacked whom, when, losses, damage), unless a battle is in progress;
- replays can come later, if ever.

### 13. Battles nobody watches still happen (our own, following openage idea 10)
Computer-against-computer battles, and battles the player chooses not to watch, run through the same `Battle` with no screen, in bigger steps, and apply the same result. One rule set means the watched and unwatched results agree. If that ever costs too much, a strength formula can stand in, checked against the full rules by a test.

## Licences and asset rights

| Project | Code | Assets in the repo | What we may take |
| --- | --- | --- | --- |
| djpav/threejs-tower-defense | MIT | No art files: models are built from Three.js primitives and sounds are synthesised; only screenshots | Patterns, rewritten. A copied snippet would keep its MIT notice. Not the screenshots. |
| Ugh-Guys- | CC0 1.0 | Models, terrain and sound are made in code. But `landing/img/` (key art, faction sigils, character cards) and `public/portraits/` (six pixel portraits of named characters for an easter-egg dialogue) have no stated source; the image README calls them key art "dropped in" separately. | Patterns, rewritten. None of those images, and none of the faction names, lore or setting. |
| frostmarch | MIT | `public/hero.webp` was made with OpenAI image generation (per `CREDITS.md`). Fonts (OFL) load from Google Fonts. The UI kit and icons keep their own licences. | Patterns, rewritten. Not the portrait, the characters or the React/Next stack. |
| Casmo/tower-defense | MIT (2014) | OBJ models, textures, smoke sprites, level images and a web font with no per-file credits; bundled copies of three.js, OrbitControls, OBJLoader, tween.js, Bootstrap and javascript-astar under their own licences | Ideas only. Its assets have no stated rights, and the code uses a three.js API that no longer exists. |

Our models stay procedural (`view3d/models.js`) and our sounds stay synthesised (`audio.js`). Any outside asset added later gets its own licence check and a line in a credits file before it's committed.

## What not to take
- **Art:** any image, model, texture, font or portrait from these repos (see the table above).
- **Their stacks:** TypeScript, Vite, Tailwind and lil-gui (djpav); React, Next and shadcn (frostmarch); the Discord SDK, relay servers and multiplayer (Ugh-Guys); Web Worker A* and the 2014 three.js (Casmo). Pocket Metropolis stays plain JavaScript with no npm dependencies and our vendored three.js r169.
- **Their content:** names, factions, lore, unit rosters, stat tables and level layouts. Nothing from GUNS UP! itself.
- **Full real-time strategy micro:** box-select, control groups and hotkeys for hundreds of units, worker gathering mid-battle, hero levelling. A few squads and defences is the scale that fits a city game.
- **A separate world:** no second terrain or map system for battles. Battles reuse the town's tiles and the 3D chunks we already build.
- **New-mesh-per-shot effects:** use instancing, as the rest of our 3D view does.

## Questions for Andre before any battle work starts
1. **Tone:** can homes be hit, and what happens to residents? Suggestion: nobody in the town is hurt. Residents shelter during a battle, and homes are only ever caught by splash.
2. **Stakes:** what does winning take from the loser? Suggestions: a capped share of its money and the damage done, never buildings or ownership; a protection period after any battle.
3. **Default:** should raids on your town be off, gentle or fierce by default?
4. **Eras:** should troops and defences change with the era (militia and earthworks early on, modern units later)? Eras already gate buildings.

## A possible order, when battle work starts
None of this is scheduled. Each step is a separate, tested pull request.

1. **Foundation:**
   - the remaining openage foundation steps (stances and the scheduled event queue);
   - `systems.military` with a save migration;
   - barracks, a wall, one defence and one troop type, as data gated by era;
   - the computer planner budgets for them.
2. **Rules:** `battle.js` and its tests:
   - a flow field over the defender's real tiles;
   - defence targeting, projectiles and impacts;
   - damage written back to structures;
   - auto-resolve with no screen.
3. **3D battle view:**
   - the defender's town from the existing chunks;
   - instanced troops and projectiles;
   - a battle bar (deploy, speed, retreat), pause-while-planning and a result screen.
4. **Computer attacks:** strategy in `cpuPlanner.js` (strength, cooldown, warning ahead) and tactics in the battle (mass, push, retreat, counters).
5. **You attack the computer town:** deploy edge on the countryside side, rules for what's taken, protection timer.
6. **Balance and polish:**
   - damage-per-cost tests and the conflict setting;
   - damage stages on buildings;
   - alerts.
