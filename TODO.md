# Pocket Metropolis to-do

`[ ]` to do · `[x]` done · **Decision** marks a choice to settle before building.

## Done

- [x] Isometric pastel city on canvas with build tools, bounce and dust effects, day/night cycle
- [x] Residents move into the most desirable homes; cars and pedestrians
- [x] Versioned saves with migrations; Random Town; deployed on Vercel
- [x] 32×32 map, jobs (shop, office), services (school, clinic), traffic, Inspect tool, map views, speed controls
- [x] Life Story, first version (see section 1)
- [x] Phone layout: Life and a controls sheet up top instead of a column of side buttons; compact landscape layout
- [x] Phase 1 polish: sound effects and ambience, drag to build, undo and redo, buildings that grow and vary, seasons and weather
- [x] Town budget (costs, taxes, upkeep, top earners) and five new buildings: cottage, apartments, café, mall, factory
- [x] Notable people (Civ-style great people) with town-wide bonuses
- [x] Growing through the eras (ideas from genesis): a seed in 1850 that grows by itself, five eras that change roads, lamps, vehicles and buildings, town decisions with good and bad effects, a town history
- [x] Main person you follow on the map; the story passes to their children (or a niece or nephew) generation after generation
- [x] Three save slots
- [x] Extreme weather: storms, heatwaves, blizzards, floods, tornadoes and hurricanes that damage or destroy buildings and roads; warnings and preparing; repairs; building code and flood wall; Off/Gentle/Wild setting
- [x] Service quality (idea from OpenTTD's station ratings): schools, clinics, libraries, universities and fire stations have a capacity; crowded ones slip in quality gradually, shrinking their coverage; residents shared by distance and size; shown in the inspector and Services view; advisor and growth respond
- [ ] Service quality next: capacity for cafés, playgrounds and sports fields
- [x] Town reputation (idea from OpenTTD's local authority rating): a slow score from greenery, upkeep and service reach; titles; a pull on home appeal and growth; shown in the City panel
- [ ] Town reputation next: more reasons to gain or lose it (decisions, bulldozing occupied homes), and a link to notable people arriving
- [ ] Weather next: fire station that puts out fires, insurance, earthquakes, a weather forecast in the stats bubble
- [ ] Eras next: a growth timelapse to replay the town from its first road, a chronicle camera that drifts to where things happen, trains and a station in the railway age, buses in the motor age
- [x] Townsfolk (ideas from emergent-city): named residents with personalities, needs and daily routines; friendships, love and weddings; favourite places; town news; mood dots on walkers; unmet needs as resident wishes
- [ ] Townsfolk next: tap a walker to follow them, birthdays and babies for married couples, pets, neighbourhood character (leafy uptown or busy quarter) from who lives where, a weekly town festival
- [ ] Special buildings and bonuses for notable people (a lab for scientists, a gallery for artists, a stadium for athletes)
- [x] New town: sandbox or milestones, small/medium/large maps, empty land or a starter town
- [x] Traffic: congestion-aware routes, through traffic only, and road suggestions you can build in one tap
- [x] Phase 4: share links, minimap, trends, colour-blind friendly colours, larger text
- [x] Street names and house numbers, shown on the map and used in Life Story instead of coordinates
- [x] Phase 3 Life Story: activities, buying a home, real neighbours, 34 new events, the character walking on the map, achievements and ribbons
- [x] Phase 2 goals: milestones (Hamlet → Metropolis) with unlocks and a celebration, playground and sports field, resident thoughts with Show me, +/− desirability feedback when placing

## 1. Life Story: live one resident's life

You create a main character who moves into your city. Every so often a text event pops up, like a message: *"Your neighbour invites you to the park on Saturday."* You pick one of two to four choices, and each choice leads to its own outcome that changes your character's stats and story (in the spirit of BitLife). The city you build shapes that life: the schools, clinics, jobs and parks you place decide which events and careers are possible.

### 1a. Create a character
- [x] Creation screen: name, pronouns, look (skin tone, hair, outfit colour)
- [x] Two starting traits that tilt outcomes (Curious, Outgoing, Thrifty, Sporty, Creative, Calm…)
- [x] **Decided:** born as a baby into a family living in one of the city's homes
- [x] A pin marks the character's home (and later their workplace) on the map
- [x] Show the character as a highlighted walker on the map
- [x] Save the character with the city (stored in `city.systems.life`, so no save migration was needed)

### 1b. Stats, age and life stages
- [x] Stats from 0 to 100: Happiness, Health, Smarts, Looks; plus Money
- [x] **Decided:** both. A year passes per in-game day in the background, and Age up skips ahead; life time stops while an event waits
- [x] Life stages: child, teen, young adult, adult, senior; a life ends, and you can continue as your child
- [x] Life log: a scrollable timeline of every event and choice ("Age 17: You aced your exams.")

### 1c. Event engine
- [x] Data-driven events: conditions (age, stage, stats, traits, flags, city facts), text with `{name}` placeholders, choices, weighted outcomes, stat changes, follow-up events
- [x] Bulldozing the character's home or workplace changes their life straight away
- [x] Scheduler with cooldowns so events don't repeat too soon; nothing fires while paused
- [x] Message-style pop-up card that works on phones, with an outcome card showing stat changes
- [x] Event chains through flags (dating leads to moving in, proposing and a baby)
- [x] Unit tests for condition matching, outcome rolls and chains

### 1d. Link the life to the city
- [x] School nearby: school events and faster Smarts growth; no school means fewer options
- [x] Clinic nearby: illnesses are milder and recovery faster
- [x] Careers come from real workplaces (shop, office, school, clinic); applications fail when there are no openings
- [x] Traffic on your commute adds stress events; parks and trees near home add calm ones
- [x] Your character walks their real commute (driving is still to do)
- [x] Moving house: choose a new home among vacancies, with desirability shown

### 1e. First content pack
- [x] 44 events across babyhood, childhood, teen years, adulthood and old age
- [x] Relationships: family, friends and a partner, each with closeness from 0 to 100
- [x] Careers with promotions: shop assistant → shop manager, office junior → director, teacher, nurse → doctor
- [x] Money: yearly savings from wages, purchases, rent

### 1f. Polish
- [x] Badge on a Life button when an event is waiting
- [ ] Settings: event frequency, pause the city while an event is open
- [x] More events: siblings, neighbours from real nearby homes, city milestones, weather and seasons, playground and sports field (78 events in all)
- [ ] Pets with names you choose; more senior and teen events
- [x] Choose with the keyboard; respects reduced motion

## 2. Next up (from the GitHub research plan)

- [x] Milestones and unlocks: Hamlet → Village → Town → City → Metropolis, unlocking buildings with a small celebration
- [x] Resident thoughts and advisor hints that point to real places on the map
- [x] Floating "+8" desirability feedback when placing parks and services
- [x] **Decided:** no coins for now; milestones are the goal
- [ ] More milestone unlocks as new buildings arrive (community centre, bus stop, police and fire)
- [x] Life Story activities you can do any time (study, exercise, date, visit, shop, volunteer, overtime, babysit)
- [x] Buy a real home in the city, priced by desirability
- [x] More Life Story events, achievements (kept across lives) and life ribbons
- [ ] **Decision:** move events to inkjs once there are a few hundred (plain JS data is fine for now)
- [x] Share a city as a link (built-in deflate, no library needed); visiting keeps your own town safe
- [x] Colour-blind friendly colours and a larger-text option

## 3. Ideas from IsoCity

From [isometric-city](https://github.com/uxcaleb/isometric-city) (originally amilich/isometric-city) (MIT). Ideas to adapt, not code to copy.

- [x] Minimap for the bigger map; tap to jump there
- [x] Advisors: short hints such as "The roads are jammed at rush hour" (resident thoughts)
- [ ] Roads over water drawn as bridges
- [ ] Buses and bus stops; trains later
- [ ] More building variety: small and medium houses, apartments, a mall
- [ ] Buildings bigger than one tile (2×2), which needs multi-tile footprints in the state
- [x] Recreation: playground and sports field; the entertainment factor is on
- [ ] Community centre
- [ ] Police and fire stations with gentle incidents (a small fire, a lost cat), turning on the safety factor
- [ ] City name generator and several saved cities
- [x] Statistics panel with history sparklines (Trends in the City panel)

## 3b. Reference for world expansion: openage

[SFTtech/openage](https://github.com/SFTtech/openage) (GPL-3.0-or-later): ideas only, never code or assets. Notes and the ideas ranked for civilisations, trade, diplomacy, territory and warfare are in [docs/references/openage.md](docs/references/openage.md).

- [x] Foundation, part 1: a world with your town and a computer-run neighbour, each a full town with its own money and simulation, saved inside your save (`world.js`)
- [x] A computer town that grows by itself under the player's rules (`cpuPlanner.js`: growth.js with everything paid, saving up for essentials, answering decisions)
- [ ] Foundation, part 2: a scheduled event queue and ownership/stances, once towns start to interact
- [ ] More computer towns (`World.addNeighbour()` already places them), personalities for their planners, and naming your own town
- [ ] Exploration and territory (line of sight, explored/visible masks, borders)
- [ ] Trade (caravans with activity graphs and keyframed movement, distance-based profit, shared prices)
- [ ] Diplomacy (treaties, tribute) and calm, abstract warfare (army supply, sieges as scheduled events)

## 3c. Reference for a 3D battle mode

A battle mode in the spirit of GUNS UP!: defend your town from a computer town, or attack one, with battles fought over the real towns (their owners, budgets, troops and lasting damage). Notes on four open-source games (djpav/threejs-tower-defense and atxgreene/Ugh-Guys- first, then cola-runner/frostmarch and Casmo/tower-defense), their licences and asset rights, the ideas ranked, and questions to settle first are in [docs/references/battle-mode.md](docs/references/battle-mode.md). Patterns only, rewritten in our own code; no art or content from them or from GUNS UP!.

Direction approved by Andre: a separate, permanent military base; GUNS UP!-style real-time battles with an angled and a free camera; strategic CPU waves; garrisons plus reinforcements; squad orders; play or auto-resolve; the world pauses during battle; tactical pause; save and resume; nothing happens offline. Then diplomacy, trade and espionage.

Phase 1 (done): a playable base and battle, integrated with the two-town world.

- [x] Military budget: automatic share of income (adjustable), emergency transfers, soldiers' pay, unpaid morale (`military.js`)
- [x] The base: command post, sandbags, MG nests, bunkers, mortar pits; protected routes; three upgrade levels; lasting damage; prioritised repair crews and rush repairs
- [x] Soldiers: regular training, emergency recruitment, hired specialists (medic); guard posts and reserve; experience and ranks; injuries and recovery; the fallen remembered
- [x] `battle.js`: waves, garrison, reinforcement squads with a cooldown, orders (move, hold, charge, fall back), artillery, cover, morale and withdrawal, retreat, wave pull-backs, deterministic, save and resume, auto-resolve
- [x] Computer raids (`warRoom.js`): its own funded army, counters to your defences, warning ahead, world pauses, consequences for both towns (casualties, damage, loot, protection), town history
- [x] The base and battle screens with the 3D field (`militaryUI.js`, `view3d/battle3d.js`), phone layout

Phase 1b (done): attacking the computer.

- [x] The computer builds its own base from its military budget (nests, bunkers and mortars beside the attackers' way, sandbags on it) and posts guards beside its defences, keeping the rest free to raid
- [x] Attack a neighbour's base from Base → War: you command the attacking squads (left, centre or right of their edge), they defend with guards, reserve, defences and artillery; play it or leave it to your officers
- [x] Two forward positions on every base, captured by standing on them unopposed; the holder may reinforce there
- [x] Victory only by defeating the defending army (soldiers, reserve and armed defences) or routing it; the command post falling is a heavy morale blow, not a win by itself; withdrawal on broken morale or after five minutes; spoils, protection and rest afterwards

Next slices:

- [ ] More troop types and specialist abilities with manual triggers; elite units and temporary hires; research and military building upgrades (barracks, hospital, depot); modern-to-futuristic tiers
- [ ] Supply: production, purchase, depots, battlefield resupply, convoys (play or auto-resolve)
Phase 2a (done): diplomacy.

- [x] Stances (war, no treaty, peace protection, non-aggression pact, alliance); raids and attacks only in a declared war (replaces the temporary automatic hostility)
- [x] Mayors with personalities (aggression, greed, honour, caution) that change with battles, betrayals, gifts, lost wars and long peace or war
- [x] Trust per mayor and your reputation; betrayal when a war breaks a treaty
- [x] Negotiation with counteroffers and patience; terms: money now, daily tribute, army caps, duration
- [x] Mayors act by themselves: declare war, sue for peace (paying when losing), demand surrender when winning, offer pacts and alliances
- [x] Peace ends the war, turns back raids on the way, protects both bases; terms are kept (tribute, army caps)
- [ ] Next for diplomacy: relations between computer towns (once there are several), alliance effects (shared intelligence, mutual defence), trade agreements
- [ ] Trade: visible deliveries, dynamic prices, raids on shipments only during declared wars, trade suspended in war
- [ ] Espionage: fog of war and reconnaissance, last-known positions, intelligence funding from the military budget, counterintelligence, captured spies, then playable rescue missions

The mayor (done): a second person you control.

- [x] Your main person's father is mayor, with skills, three actions a day and four duties (speech, fundraiser, base inspection, meeting a neighbour's mayor); the family keeps the office (acting relative until your main person is 18)
- [x] Auto mode for the mayor's duties and your main person's activities, with a focus; upbringing decides the heir's skills as mayor
- [ ] Ideas: more duties (open a building, call an election, set the tax rate), the mayor leading troops in battle, elections and rivals, mayor events in Life Story

Town upgrades (done): a skill tree for the town.

- [x] Points from growth (start, each town title, every 50 residents at the biggest); four branches of six (Treasury, Wellbeing, Services & growth, Defence); free to give points back
- [ ] Ideas: upgrades unlocked by eras, a branch for the computer's mayors, upgrades for trade and espionage once they exist

## 4. Deploy and tooling
- [ ] Move the code to `andrerlaster-lgtm/Metropolis` and link it to Vercel so every push redeploys (until then each deploy is started by hand)
- [ ] Test pinch and long-press on a real phone
- [x] Run `npm test` and the build on every pull request with GitHub Actions (`.github/workflows/ci.yml`)

## 3D view and living streets: what's next

Done: the 3D view (orbit, street level, follow, quality settings, touch controls), models for every structure, sidewalks and zebra crossings in both views, destination-based walkers, cars and people giving way at crossings, weather, smoke and disasters in 3D.

Not verified yet: frame rates on real devices. The headless browser used for testing has no graphics card, so only the JavaScript side was measured (about 4 ms a frame on a 40×40 town while the software renderer shares the CPU; chunk rebuilds ~1.4 ms in Node). Try it on a Mac and a phone with Quality on Auto.

Ideas, roughly in order:
- Street-name signs at junctions in 3D (the overhead view already names streets).
- Bus stops and benches along long streets, out of the walking line.
- Free CC0 models (Kenney city kits, Open Source 3D Assets) for street furniture or vehicles, shrunk with glTF-Transform the way Bellemorne did (Studio technique T7). The procedural models match the overhead view's style, so only where a model is clearly better.
- Building from the 3D view (place and bulldoze with the street-level camera).
- Level of detail for very large maps: simpler far chunks, fewer windows far away.
