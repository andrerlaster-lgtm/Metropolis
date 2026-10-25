# Town upgrades: the skill tree

The tree lives in `src/skills.js` (rules and data) and `src/skillsUI.js` (the sheet). This page lists every upgrade, says where points come from and why the numbers are what they are, and keeps ideas for upgrades the game can't support yet.

## Points

| Source | Points |
| --- | --- |
| To start | 1 |
| Each town title past Hamlet (Village, Town, City, Metropolis) | 1 each, 4 in all |
| Residents at the town's biggest | 1 per 20 (1 per 12 on a small 16 × 16 map) |
| Each new era (Railway, Motor, Modern, Future) | 1 each, 4 in all |
| Each new generation of your family | 1 each, up to 10 |
| Founding families (Leadership & Legacy, tier 6) | 1 more per generation, up to 10 |
| Boom town (Housing & Growth milestone) | 1 more per 50 residents past 500 |

Points never go away: the town remembers its most residents, its latest era and its latest generation. The two upgrades that earn points can only be given back once the points they earned aren't spent.

## Shape and costs

- 74 upgrades, 8 branches, tiers 1 to 7. The 24 upgrades of the first tree keep their ids, effects and costs.
- Costs: tiers 1–2 cost 1 point, tiers 3–4 cost 2 (the first tree's own tier-3 upgrades still cost 1), tiers 5–6 cost 3, milestones 4. Town council costs 3.
- Gates: tiers 3–4 need the Village title, tiers 5–6 the Town title. Each branch's milestone needs the City title **or** your family's third generation, so a small map (which rarely reaches City) can still get there with time. Founding families needs the second generation.
- Forks: every branch has one at tier 5. The two sides exclude each other; give one back to take the other.
- The whole tree costs 150 points; one side of every fork, 126.

## Balance

Measured by letting towns build themselves (Node, sandbox money, 160 in-game days): a small map levels off near 180 residents (Village), a medium one near 480 (City), a large one near 770 (City). Players who build densely get further. With those numbers (out of 126):

| Stage | Points |
| --- | --- |
| A new town (40 residents) | 3 |
| A young Town (200 residents, Motor age, 2nd generation) | 16 |
| Small map, late (220, Town, Future, 8th generation, Founding families) | 39 (31%) |
| Medium map, late (480, City, Future, 8th generation, Founding families) | 46 (37%) |
| Large map, late (770, City, Future, 8th generation, Founding families, Boom town) | 65 (52%) |
| Large, dense and old (1,500, Metropolis, 11th generation) | 124 (98%) |

So a town specialises: a medium town over a whole game finishes two or three branches, or reaches the middle of most. The tests in `tests/skills.test.mjs` hold these ranges.

### Limits

`CAPS` in `skills.js` bound what upgrades add up to, whatever is chosen (the tests try every combination of fork choices): homes at most 12% happier from upgrades; business taxes at most +60%, home taxes between −15% and +15%; building costs at least 85%, upkeep at least 75%; homes hold at most 30% more; growth at most 35% faster; newcomers at most 60% faster; jobs at most +20% overall (+60% for one kind of workplace); services serve between 85% and 160%; disasters do at least 60% (storms), 45% (floods) and 55% (fires) of their damage; training at least half the time; reputation at most +6 points; the army at most 6 more soldiers; the mayor's duties at most 1.8× (speeches) to 2.5× (inspections).

## The upgrades

### Treasury

More money in, less going out.

| Tier | Upgrade | Cost | Needs | Effect |
| --- | --- | --- | --- | --- |
| 1 | Tax office | 1 | — | Home taxes bring in 10% more. |
| 2 | Market days | 1 | Tax office | Businesses pay 15% more tax. |
| 2 | Thrifty builders | 1 | Tax office | Building costs 10% less. |
| 3 | Trade fair | 1 | Market days | Businesses pay another 15% more tax. |
| 3 | Maintenance crews | 1 | Thrifty builders | Upkeep of roads, schools, parks and services costs 20% less. |
| 4 | Town bonds | 2 | Trade fair or Maintenance crews | A steady income of $25 a day, plus 25¢ for every resident. |
| 5 | Merchants’ charter *(fork)* | 3 | Town bonds | Businesses pay 12% more tax, but home taxes bring in 6% less. |
| 5 | Homestead relief *(fork)* | 3 | Town bonds | Home taxes bring in 8% less, and every home is 2% happier. |
| 6 | Savings bank | 3 | Merchants’ charter or Homestead relief | The treasury earns 0.5% a day on the money it holds, up to $150 a day. |
| Milestone | Town mint | 4 | Savings bank | Town bonds pay 50% more, and the mayor’s fundraisers raise 25% more. |

### Wellbeing

Happier homes and a good name.

| Tier | Upgrade | Cost | Needs | Effect |
| --- | --- | --- | --- | --- |
| 1 | Town gardeners | 1 | — | Parks and trees make homes 25% nicer. |
| 2 | Quiet streets | 1 | Town gardeners | Busy roads bother homes 40% less. |
| 2 | Clean air rules | 1 | Town gardeners | Factory smoke bothers homes 40% less. |
| 3 | Festivals | 1 | Quiet streets | Every home is 3% happier. |
| 3 | Sport for all | 1 | Clean air rules | Playgrounds and sports fields make homes 50% nicer. |
| 4 | Civic pride | 2 | Festivals or Sport for all | Every home is another 5% happier. |
| 5 | Tree-lined boulevards *(fork)* | 3 | Civic pride | Parks and trees make homes another 15% nicer, and busy roads bother them 20% less. |
| 5 | Car-free square *(fork)* | 3 | Civic pride | Busy roads bother homes 35% less and every home is 2% happier, but roads carry 8% less traffic. |
| 6 | A good name | 3 | Tree-lined boulevards or Car-free square | The town’s reputation scores 6 points higher, so it draws more newcomers. |
| Milestone | Beloved town | 4 | A good name | The mayor’s speeches last twice as long, and every home is 3% happier. |

### Housing & Growth

More homes, more newcomers, faster growth.

| Tier | Upgrade | Cost | Needs | Effect |
| --- | --- | --- | --- | --- |
| 1 | Roomier homes | 1 | — | Homes hold 10% more people. |
| 1 | Land office | 1 | — | When the town builds itself, it builds 15% faster. |
| 2 | Riverside lots | 1 | Roomier homes or Land office | Water views make homes 60% nicer. |
| 3 | Welcome centre | 2 | Riverside lots | Newcomers move in 50% faster. |
| 4 | Fine townhouses | 2 | Welcome centre | Notable people are drawn to the town 25% sooner. |
| 5 | Taller blocks *(fork)* | 3 | Fine townhouses | Homes hold another 12% more people, but busy roads bother them 10% more. |
| 5 | Garden city *(fork)* | 3 | Fine townhouses | Parks and trees make homes 20% nicer, and homes hold 4% more people. |
| Milestone | Boom town | 4 | Taller blocks or Garden city | One more upgrade point for every 50 residents past 500 at the town’s biggest, and the town builds itself 15% faster. |

### Education & Services

Schools, clinics and fire stations that reach and serve more.

| Tier | Upgrade | Cost | Needs | Effect |
| --- | --- | --- | --- | --- |
| 1 | Wider catchments | 1 | — | Schools and clinics reach 1 tile further. |
| 2 | Bigger classrooms | 1 | Wider catchments | Schools, libraries and universities each look after 20% more residents. |
| 2 | Night nurses | 1 | Wider catchments | Clinics each look after 25% more residents. |
| 3 | Play streets | 1 | Bigger classrooms or Night nurses | Playgrounds and sports fields reach 1 tile further. |
| 3 | Fire drills | 1 | Bigger classrooms or Night nurses | Fire stations reach 2 tiles further. |
| 4 | Good schools | 2 | Play streets or Fire drills | Homes value having a school or clinic nearby 25% more. |
| 5 | Village schools *(fork)* | 3 | Good schools | Schools reach 2 tiles further, but each looks after 10% fewer residents. |
| 5 | Boarding schools *(fork)* | 3 | Good schools | Schools each look after 35% more residents, but reach 1 tile less. |
| Milestone | Seat of learning | 4 | Village schools or Boarding schools | Schools, clinics and fire stations each look after 15% more residents, and clinics reach 1 tile further. |

### Infrastructure

Roads that flow, a town that weathers storms.

| Tier | Upgrade | Cost | Needs | Effect |
| --- | --- | --- | --- | --- |
| 1 | Road menders | 1 | — | Roads carry 15% more traffic before they jam. |
| 1 | Weather watchers | 1 | — | Warnings of extreme weather come twice as early: about 6 hours ahead instead of 3. |
| 2 | Storm shutters | 1 | Weather watchers | Storms, wind and hail do 20% less damage to buildings. |
| 2 | Public works | 1 | Road menders or Weather watchers | Damage is repaired twice as fast, and repairs cost 25% less. |
| 3 | Flood banks | 2 | Storm shutters | Floods and washouts do 40% less damage. |
| 4 | Firebreaks | 2 | Flood banks or Public works | Fires and lightning do 30% less damage. |
| 5 | Tramways *(fork)* | 3 | Firebreaks | Roads carry 25% more traffic before they jam. |
| 5 | Cycle lanes *(fork)* | 3 | Firebreaks | Busy roads bother homes 25% less, and roads carry 8% more traffic. |
| Milestone | Resilient town | 4 | Tramways or Cycle lanes | Every kind of disaster does another 20% less damage, and warnings come 50% earlier still. |

### Industry & Commerce

More jobs and busier businesses.

| Tier | Upgrade | Cost | Needs | Effect |
| --- | --- | --- | --- | --- |
| 1 | Business hubs | 1 | — | Workplaces offer 10% more jobs. |
| 1 | Craft guilds | 1 | — | Shops, cafés and bakeries pay 20% more tax. |
| 2 | Rail siding | 1 | Business hubs or Craft guilds | Factories offer 15% more jobs and pay 10% more tax. |
| 3 | Office quarter | 2 | Rail siding | Offices and malls offer 15% more jobs and pay 15% more tax. |
| 4 | Smoke filters | 2 | Office quarter | Factory smoke bothers homes 30% less, and factories pay another 10% more tax. |
| 5 | Free trade *(fork)* | 3 | Smoke filters | Businesses pay 10% more tax, but upkeep costs 5% more. |
| 5 | Co-operatives *(fork)* | 3 | Smoke filters | Workplaces offer 8% more jobs, and homes value good jobs 15% more. |
| Milestone | Industrial age | 4 | Free trade or Co-operatives | Factories offer 25% more jobs and pay 20% more tax, and their smoke bothers homes 20% less. |

### Defence

A stronger, cheaper military base.

| Tier | Upgrade | Cost | Needs | Effect |
| --- | --- | --- | --- | --- |
| 1 | Drill sergeants | 1 | — | Recruits train 30% faster. |
| 2 | Army engineers | 1 | Drill sergeants | Defences and their upgrades cost 20% less. |
| 2 | Field hospital | 1 | Drill sergeants | Wounded soldiers recover 40% faster. |
| 2 | Scouts | 1 | Drill sergeants | Raids are spotted 50% earlier, so you have longer to get ready. |
| 3 | Repair crews | 1 | Army engineers | The base is repaired 50% faster. |
| 3 | Quartermaster | 1 | Field hospital | Soldiers’ pay costs 20% less. |
| 4 | Veteran instructors | 2 | Repair crews or Quartermaster | New recruits start as Corporals. |
| 5 | Standing army *(fork)* | 3 | Veteran instructors | The base holds 4 more soldiers, but soldiers’ pay costs 10% more. |
| 5 | Citizen militia *(fork)* | 3 | Veteran instructors | Recruits cost 30% less and train another 20% faster. |
| Milestone | Citadel | 4 | Standing army or Citizen militia | The base holds 2 more soldiers, the mayor’s base inspections do twice as much, and raids are spotted 50% earlier still. |

### Leadership & Legacy

Better mayors, smoother successions, a lasting family name.

| Tier | Upgrade | Cost | Needs | Effect |
| --- | --- | --- | --- | --- |
| 1 | Town clerks | 1 | — | The mayor’s skills grow 50% faster with every duty. |
| 1 | Oratory lessons | 1 | — | The mayor’s speeches lift homes 30% more. |
| 2 | Envoy service | 1 | Town clerks or Oratory lessons | Meeting a neighbour’s mayor builds 40% more trust, and their grudges fade 50% faster. |
| 3 | Family tutors | 2 | Envoy service | When your heir takes office, they start with 10 more in every mayor skill. |
| 3 | Trusted regents | 2 | Envoy service | A relative standing in as mayor leads with at least 50 in every skill. |
| 4 | Town council | 3 | Family tutors or Trusted regents | The mayor can do 4 duties a day instead of 3. |
| 5 | People’s mayor *(fork)* | 3 | Town council | Speeches lift homes another 20% more, and meetings with neighbours build 20% more trust. |
| 5 | Shrewd mayor *(fork)* | 3 | Town council | Fundraisers raise 40% more, and base inspections do 30% more. |
| 6 | Founding families | 3 | People’s mayor or Shrewd mayor; generation 2 | One more upgrade point for each generation of your family after the first (up to 10). |
| Milestone | Dynasty | 4 | Founding families | Every mayor duty does 15% more, and a new mayor starts with at least 45 in every skill. |

## Ideas for later (not in the game)

These would need systems the game doesn't have yet, so they aren't shown as upgrades:

- **Crime and policing** (a Safety factor exists in desirability.js but is switched off): a constabulary, street lighting against crime.
- **Utilities** (power, water; the factor is switched off): a waterworks, a gasworks, electric street lights.
- **Overcrowding and walkability** (switched-off factors): tenement reform, pedestrian streets.
- **Trade between towns** (diplomacy has tribute but no trade): trade routes, a customs house.
- **Tourism**: visitors and a hotel income.
- **Education levels** for residents (the Life Story character has smarts, but residents don't): a university that raises the town's skill and wages.
- **Health and lifespan** for residents: clinics that let people live longer.
- **Legacy heirlooms with effects** (legacy.js keeps heirlooms, which are words only): a family portrait gallery that gives a bonus per heirloom.
