# Reference: openage

- **Project:** [SFTtech/openage](https://github.com/SFTtech/openage), a free engine that recreates Age of Empires II (C++ engine, Python tooling, its own data language called nyan).
- **Read:** the design docs in `doc/` at commit `6d147f4` (2026-10-20): game simulation, event system, curves, activities, game entities and components, pathfinding, the AI draft, the nyan ability and data reference, and the reverse-engineered market notes.
- **Licence:** GPL-3.0-or-later, including its docs. **Ideas only.** No code, data files, docs text or Age of Empires assets come into Pocket Metropolis. Everything below is our own summary and our own design. If we ever want to copy something from it, ask Andre first; the answer will almost certainly be no, because GPL code would force the whole game under the GPL.
- **Why it's here:** a reference for the long-term goal: several AI civilisations, towns that grow on their own, trade, diplomacy, territory and warfare. It's not a replacement engine. Pocket Metropolis keeps its own simulation, the overhead builder and the Three.js 3D view.

## What we already have (don't rebuild these)

| Need | Already in Pocket Metropolis |
| --- | --- |
| A town that grows by itself | `growth.js` (demand-driven building), eras, decisions |
| Agents with a daily life | `townsfolk.js`: a utility AI picks what each named resident does each hour |
| Pathfinding | Typed-array Dijkstra for commutes (`labor.js`); the sidewalk network for walkers (`sidewalks.js`) |
| Economy | `economy.js`: budget, taxes, upkeep, the daily ledger |
| Events | `city.emit` / `city.on` for map changes; a fixed-step tick (`SIM_STEP`) for everything else |
| Hazards | `disasters.js`: damage, repairs, fire cover |
| Rendering | 2D overhead view and the Three.js 3D view, both reading the same state |
| Saves | Versioned saves with migrations (`persistence.js`) |

openage is useful where we have nothing yet: more than one player, ownership, things that happen far apart in time and space, and units with multi-step jobs.

## The most reusable ideas, ranked

### 1. Ownership and diplomatic stances (foundation for everything else)
Every unit and building records which player owns it. Players have a **stance** toward each other: self, ally, neutral or enemy. Abilities are gated by stance. For example, a market can be marked "usable by allies and neutrals", so whether an enemy can trade there is data, not special-case code.

*For us:* a `civs` list, an owner on structures (and later units), and a stance table between civs. Gate actions by stance in one helper (`canUse(actorCiv, targetCiv, action)`). This changes the save shape, so it needs a migration and a test (AGENTS.md).

### 2. A scheduled event queue for world-scale happenings
Their simulation is driven by an event loop:
- Each event has a time it should happen, a handler and a target.
- Events run in time order once the clock passes them.
- An event is dropped automatically if its target no longer exists.
- When something an event depends on changes, the event is asked to recompute its time ("predict invoke time").

*For us:* keep the fixed tick for the town itself, and add a small, deterministic event queue (keyed by game time, ties broken by insertion order) for slow, far-apart things:
- a caravan arriving;
- a treaty expiring;
- an AI town's next decision;
- a siege resolving.

Nothing needs to tick every frame to make these happen. Our labor heap code can be reused for the queue.

### 3. Positions as keyframes ("curves") for units on long journeys
They store values as keyframes over time and interpolate, so any moment, past or future, can be read without stepping (an idea they credit to Planetary Annihilation). Their docs warn it costs more than plain variables and is only worth it for values that change rarely or must be predictable.

*For us:* the light version only. A caravan or army stores its start time, route and speed, and its position is computed when someone looks. Off-screen movers then cost nothing per frame, both views can draw them, and the save stores four numbers instead of a moving position. Don't adopt general curve containers.

### 4. Activity graphs for multi-step jobs
A unit's behaviour is a small graph of nodes:

| Node | What it does |
| --- | --- |
| start | where the job begins |
| task | runs one action |
| branch on a condition | picks the next node from the current state |
| wait for an event, then branch | pauses until something happens |
| end | the job is done |

Units of the same type share one graph, and the unit remembers which node it's on. Their example is "attack" really meaning "walk there, then fight, then look for the next target".

*For us:* a tiny interpreter over plain JSON-like data, for jobs such as:
- a trade caravan: load, travel, sell, return, repeat;
- settlers: walk out, found a town;
- a scout: explore until the area is known, then come home.

The townsfolk utility AI keeps deciding **what** to do; an activity graph carries out **how**. The graphs are data, so they can be tested in Node and saved as "graph id + current node".

### 5. Composition: units are built from abilities
A unit has no class hierarchy. It's an id plus a set of components (Move, LineOfSight, Storage, Trade, Attack…), and stateless "system" functions do the work on whichever components a unit has. Their docs insist systems never call each other; waiting and sequencing belong to the activity graph.

*For us:* the same spirit as `STRUCTURES` in `config.js`. Define world units as data, for example `{ move: { speed }, carry: { capacity }, sight: { range }, trade: true }`, and write small functions per ability. Keep it plain JS objects, not an ECS library.

### 6. Hierarchical pathfinding with flow fields
Their two levels:
- **High level:** the map is split into square sectors joined by portals (passable gaps on sector edges), and an A* search over the portal graph picks which sectors a path crosses.
- **Low level:** inside those sectors only, a flow field is computed from a per-cell cost field (cost 1–254, 255 impassable). It records the cheapest direction from every cell to the target. One flow field serves every unit heading to the same place, which suits crowds and armies.

There can be separate grids per movement type (land, water).

*For us:* our road-graph Dijkstra already handles commutes, and the sidewalk network handles walkers, so don't replace either. Use this design only when a world map exists that is far larger than one town, or when many units share a target (an army marching on a town, everyone evacuating from a flood):
- towns become sectors and roads between towns become portals;
- flow fields cover only the open land in between.

Roads can simply be cheap cells in the cost field.

### 7. Resources: spots, gathering, drop sites and contingents
- **Resource spots:** an amount, a maximum and a decay rate.
- **Gathering:** units gather from a spot and carry the load to a drop site.
- **Storage containers:** hold resources.
- **Contingents:** a capacity some buildings provide and others use up, without being spent. Their example is population space (AoE2) or supply (StarCraft).

*For us:* our housing capacity is already a contingent in spirit. For civilisations:
- a small set of world resources (for example food, timber, stone, goods) at resource spots on the land around towns, which makes territory worth having;
- an army supply contingent provided by barracks and farms, which caps warfare naturally.

### 8. Trade: posts, routes and shared prices
- **Trade units** travel between two trade posts and earn more the farther apart they are. The AoE2 rule grows faster than distance, scaled to the map size.
- **Market prices** are shared across all markets: buying costs a fixed margin above a base price and selling a fixed margin below. Each trade nudges the base price by a fixed step between a floor and a ceiling.
- **Stance gating:** only players with the right stance may use a trade post.
- **Tribute:** sending resources to another player costs a fee.

*For us:* caravans between towns, carrying goods each town has a surplus of. Profit grows with distance, and a shared price pool falls when a good floods the market. Write our own formula and tune it for a calm game. Tribute and gifts become a diplomacy action.

### 9. Exploration: line of sight and fog of war
Each unit or building reveals a radius around it. Buildings can stay visible in the fog once they've been seen; units can't.

*For us:* per civ, an "explored" bitmask (one byte per tile, saved) and a "visible now" mask recomputed from that civ's sight sources about once a second (not saved). The overhead view darkens unexplored tiles. The 3D view hides chunks that aren't explored yet and shows last-seen buildings for areas that are explored but not in view. AI civs read only what they can see.

### 10. Military: stances, target preferences and resistances
Units have a behaviour stance (aggressive, defensive, stand ground, passive) with a search range, plus ordered preferences for which abilities to use and which unit types to target. Attacks are effects matched against resistances (damage types), and formations keep groups together.

*For us:* the game is calm. Start with abstract conflict:
- armies are numbers with a supply cost;
- a siege is a scheduled event whose outcome comes from strength, walls and the defender's stance;
- buildings take `damage` the way disasters already do, and the repair systems already exist.

Stances and target preferences carry over even to abstract battles. Add unit-level fighting only if the abstract version proves fun.

### 11. AI players as players (openage only has a draft here)
openage has **no working AI yet**, only a draft interface. The pattern in it is still the right one:
- the AI registers for events (a unit is lost, an enemy is discovered…) and also gets a slow periodic tick (about once a second) for decisions events don't cover;
- it sees only what its units can see;
- it acts through the same commands a human player uses.

*For us:* each AI civ is a "governor" that runs our existing `growth.js` for its towns, plus decisions on a slow tick:
- where to found a town;
- what to trade;
- which stance to take;
- when to build defences.

It uses its own seeded RNG so games replay the same way and tests stay deterministic. Personalities are weights (trader, builder, expansionist), much like townsfolk traits.

## What not to take
- The engine itself (C++/Python/Cython), its renderer, networking (lockstep) and the AoE2 asset converter.
- nyan as a language: plain JS data in `config.js` does the same job for us.
- Anything from Age of Empires: art, sounds, names, unit stats.
- Hard-real-time RTS controls (selecting and micro-managing hundreds of units). Pocket Metropolis stays a calm builder; civilisations play out at town scale.

## A possible order, when world expansion starts
None of this is scheduled; it's here so the first steps don't paint us into a corner.

1. **Foundation:** civ ids, ownership, the stance table, the scheduled event queue, more than one town on a world map. Save migration and tests.
2. **AI towns that grow by themselves:** the governor runs `growth.js` per town with its own seed. Both views show the other towns.
3. **Exploration and territory:** line of sight, explored and visible masks, borders grown from each town's influence (like desirability layers).
4. **Trade:** roads between towns, caravans with activity graphs and keyframed movement, distance-based profit, shared prices.
5. **Diplomacy:** stances that change through treaties, tributes and gifts, with treaty expiry as scheduled events.
6. **Warfare:** army supply, abstract sieges as scheduled events, flow-field marches for many units, damage and repair reusing the disaster systems.
