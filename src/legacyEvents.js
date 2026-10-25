// Legacy events: life events for a family line that lives through the town's history. They depend
// on the historical era, on whether you (or your family) lead the town, on war, and on how the town
// is doing, and some reach the whole town (`town` effects: money, spirit, trust, soldiers).
//
// Choices can set consequences in motion that come back years or generations later (`later`):
// { event, years: [min, max], data }. The follow-up events are `scheduled`: they never happen at
// random, only when due, and read what was chosen from `ctx.echo.data`. {who} names the person who
// set it in motion ("you", "your parent Ada", "your grandparent Ada"…).
//
// Same format as lifeEvents.js, plus `category`, `eras`, `leader` and `once: 'family'` (lifeEngine.js).

// An outcome; `town` effects given alongside the others are folded into its effects.
const o = (text, effects = {}, { town, ...extra } = {}) => ({ text, effects: town ? { ...effects, town } : effects, ...extra });
const echoIs = (key, value) => (ctx) => (ctx.echo?.data?.[key] === value ? 1 : 0);
const ADULT = ['young', 'adult', 'senior'];
const WORKING = ['young', 'adult'];

export const LEGACY_EVENTS = [
  // ===== Personal =====================================================================================
  {
    id: 'lx_apprentice',
    category: 'personal',
    eras: ['pioneer', 'railway'],
    minAge: 13,
    maxAge: 17,
    once: true,
    text: 'The {era} printer on the high street needs an apprentice, and offers {name} the place.',
    choices: [
      { label: 'Take the apprenticeship', outcomes: [o('{name} learned to set type by lamplight. Ink under the nails, but a trade for life.', { smarts: 3, money: 200, happiness: -1 }, { later: { event: 'lx_master_returns', years: [8, 14], data: { took: true } } })] },
      { label: 'Stay in school', outcomes: [o('{name} stayed at school and topped the class in sums.', { smarts: 5 })] },
    ],
  },
  {
    id: 'lx_master_returns',
    category: 'personal',
    scheduled: true,
    stages: WORKING,
    text: 'The old printer {who} was apprenticed to is retiring, and wants the press to stay in the family that learned it.',
    choices: [
      { label: 'Buy the press', outcomes: [o('{name} bought the old press. The {fullname} Gazette was born.', { money: -800, happiness: 6, smarts: 2 }, { do: (c) => c.legacy.remember('press', true), later: { event: 'lx_press_heir', years: [20, 32] } })] },
      { label: 'Wish them well', outcomes: [o('{name} shook the old printer\'s inky hand and wished them a long rest.', { happiness: 2 })] },
    ],
  },
  {
    id: 'lx_press_heir',
    category: 'family',
    scheduled: true,
    stages: ADULT,
    when: (ctx) => !!ctx.legacy.recall('press'),
    text: 'The family press {who} bought still runs, the oldest printer in {town}. It is {name}\'s turn to decide what it prints.',
    choices: [
      { label: 'Keep printing the news', outcomes: [o('The Gazette kept going. People still read it over breakfast.', { happiness: 4, money: 400 }, { town: { spirit: [0.02, 3] } })] },
      { label: 'Sell it to a big publisher', outcomes: [o('{name} sold the press for a tidy sum. The ink smell lingered for weeks.', { money: 3000, happiness: -2 }, { do: (c) => c.legacy.forget('press') })] },
    ],
  },
  {
    id: 'lx_lost_wallet',
    category: 'personal',
    stages: ['teen', ...WORKING],
    text: '{name} finds a wallet on the pavement with a name card and a fat fold of notes.',
    choices: [
      { label: 'Return it', outcomes: [o('{name} returned the wallet to its owner, who could not stop saying thank you.', { happiness: 3 }, { later: { event: 'lx_wallet_owner', years: [4, 10], data: { returned: true } } })] },
      { label: 'Keep the cash', outcomes: [o('{name} kept the money and dropped the wallet in a postbox.', { money: 300, happiness: -2 }, { later: { event: 'lx_wallet_owner', years: [4, 10], data: { returned: false } } })] },
    ],
  },
  {
    id: 'lx_wallet_owner',
    category: 'personal',
    scheduled: true,
    stages: ['teen', ...ADULT],
    text: (ctx) => (ctx.echo?.data?.returned ? 'A stranger stops {name} in the street: the owner of the wallet {who} returned years ago. They never forgot.' : 'At an interview, {name} recognises the person across the desk: the name on a wallet {who} once kept.'),
    choices: [
      {
        label: 'Say hello',
        outcomes: [
          o('They had become a bank manager, and offered {name} a little help getting started.', { money: 1200, happiness: 5 }, { weight: echoIs('returned', true) }),
          o('They looked {name} up and down for a long moment. The interview did not go well.', { happiness: -5 }, { weight: echoIs('returned', false) }),
        ],
      },
      { label: 'Keep walking', outcomes: [o('{name} hurried on. Some debts are best left alone.', { happiness: -1 })] },
    ],
  },
  {
    id: 'lx_night_school',
    category: 'personal',
    eras: ['railway', 'motor', 'modern', 'future'],
    stages: WORKING,
    text: 'Posters at the station advertise evening classes in bookkeeping, engineering and languages.',
    choices: [
      { label: 'Sign up', outcomes: [o('{name} went every Tuesday and Thursday for a year, and passed with honours.', { smarts: 6, money: -150, happiness: 1 }), o('{name} signed up, then fell asleep in the second class. Twice.', { smarts: 2, money: -150 })] },
      { label: 'Not this year', outcomes: [o('{name} put the leaflet in a drawer, maybe for next year.', {})] },
    ],
  },
  {
    id: 'lx_neural_tutor',
    category: 'personal',
    eras: ['future'],
    minAge: 8,
    text: 'The school offers a neural tutor: lessons streamed straight into a quiet headband at night.',
    choices: [
      { label: 'Try the headband', outcomes: [o('{name} woke up knowing the capitals of every country, and a strange jingle.', { smarts: 6, happiness: -1 }), o('The headband glitched. {name} dreamt in long division for a week.', { smarts: 2, health: -2 })] },
      { label: 'Learn the old way', outcomes: [o('{name} learned from books and a patient teacher.', { smarts: 3, happiness: 2 })] },
    ],
  },

  // ===== Family =======================================================================================
  {
    id: 'lx_oak',
    category: 'family',
    once: 'family',
    stages: ADULT,
    minAge: 22,
    text: '{name} has an acorn in a pot and a thought: plant a tree now that the grandchildren will sit under.',
    choices: [
      { label: 'Plant it by the house', outcomes: [o('{name} planted the oak and watered it every evening that summer.', { happiness: 4, health: 1 }, { later: { event: 'lx_oak_grown', years: [30, 45] } })] },
      { label: 'Give it to the school', outcomes: [o('{name} planted it in the schoolyard. The children named it Old Squeak.', { happiness: 3 }, { town: { spirit: [0.02, 3] }, later: { event: 'lx_oak_grown', years: [30, 45], data: { school: true } } })] },
      { label: 'Leave it on the sill', outcomes: [o('The acorn stayed on the windowsill, a small brown promise.', {})] },
    ],
  },
  {
    id: 'lx_oak_grown',
    category: 'family',
    scheduled: true,
    minAge: 4,
    text: (ctx) => (ctx.echo?.data?.school ? 'The oak {who} planted in the schoolyard is huge now. The school wants to name it after the family.' : 'The oak {who} planted by the house has grown tall and wide. Its shade covers half the garden.'),
    choices: [
      { label: 'Carve the family initials', outcomes: [o('{name} carved the initials next to the ones already there. It felt like a handshake across the years.', { happiness: 6 })] },
      { label: 'Hold a family picnic under it', outcomes: [o('Three generations of stories were told under the oak that afternoon.', { happiness: 5, health: 2, rel: { mother: 5, father: 5, child: 5 } })] },
    ],
  },
  {
    id: 'lx_letters',
    category: 'family',
    once: 'family',
    stages: ADULT,
    text: 'Clearing the attic, {name} finds a bundle of old letters. They reveal a family secret: a great-grandparent left another family behind in the old country.',
    choices: [
      { label: 'Tell the family', outcomes: [o('The family talked late into the night. It hurt, then it healed.', { happiness: -2, rel: { mother: 4, father: 4, sibling: 4 } }, { later: { event: 'lx_secret_out', years: [15, 30], data: { told: true } } })] },
      { label: 'Hide the letters', outcomes: [o('{name} tied the bundle back up and hid it under a floorboard.', {}, { later: { event: 'lx_secret_out', years: [15, 30], data: { told: false } } })] },
      { label: 'Burn them', outcomes: [o('The letters curled into smoke in the stove. Some stories end there.', { happiness: -1 })] },
    ],
  },
  {
    id: 'lx_secret_out',
    category: 'family',
    scheduled: true,
    minAge: 12,
    text: (ctx) =>
      ctx.echo?.data?.told
        ? 'A letter arrives from abroad: a distant cousin, descended from the family in the old letters {who} once shared, wants to meet.'
        : 'Fixing a creaky floorboard, {name} finds the letters {who} hid long ago. The secret is out.',
    choices: [
      {
        label: 'Reach out to them',
        outcomes: [
          o('The cousins met at the station and recognised each other\'s noses at once.', { happiness: 7 }, { do: (c) => c.addFriend(70) }),
          o('{name} wrote to the address in the letters. Years later, a reply came back.', { happiness: 4 }, { weight: echoIs('told', false) }),
        ],
      },
      { label: 'Let the past rest', outcomes: [o('{name} put the letters back. Some doors are better left closed.', { happiness: -1 })] },
    ],
  },
  {
    id: 'lx_heirloom',
    category: 'family',
    once: 'family',
    stages: ADULT,
    text: '{name}\'s grandmother presses a silver pocket watch into {name}\'s hand. "It has been in the family since before {town} had a name."',
    choices: [
      { label: 'Treasure it', outcomes: [o('{name} wound the watch every morning, and it never lost a minute.', { happiness: 4 }, { do: (c) => c.legacy.addHeirloom('the silver pocket watch', `${c.char.first} ${c.char.last}`), later: { event: 'lx_heirloom_appraisal', years: [20, 35] } })] },
      { label: 'Sell it', outcomes: [o('The pawnbroker paid well. {name} felt a small ache for years.', { money: 900, happiness: -3 })] },
    ],
  },
  {
    id: 'lx_heirloom_appraisal',
    category: 'family',
    scheduled: true,
    minAge: 16,
    when: (ctx) => ctx.legacy.state.heirlooms.length > 0,
    text: 'An antiques dealer passing through {town} asks to see {heirloom}. "That is rarer than you know," they say.',
    choices: [
      { label: 'Sell it for a fortune', outcomes: [o('The dealer paid a small fortune. The empty drawer felt strange.', { money: 6000, happiness: -2 }, { do: (c) => c.legacy.removeHeirloom('the silver pocket watch') })] },
      { label: 'Keep it in the family', outcomes: [o('{name} smiled and put it back in the drawer. Some things are not for sale.', { happiness: 5 })] },
    ],
  },
  {
    id: 'lx_fence',
    category: 'family',
    stages: ADULT,
    text: 'The {neighbour} have moved their garden fence a foot onto the family\'s land.',
    choices: [
      { label: 'Talk it over', outcomes: [o('Over tea, the fence went back where it was, and a friendship began.', { happiness: 3 }, { do: (c) => c.addFriend(55) })] },
      { label: 'Take them to court', outcomes: [o('{name} won in court, and the {neighbour} never spoke to the family again.', { money: -300, happiness: 1 }, { do: (c) => c.legacy.remember('rival', c.neighbour()?.family || 'the neighbours'), later: { event: 'lx_feud_returns', years: [15, 30] } })] },
      { label: 'Let it go', outcomes: [o('{name} let them keep the foot of land. Peace was worth more.', { happiness: -1 })] },
    ],
  },
  {
    id: 'lx_feud_returns',
    category: 'family',
    scheduled: true,
    minAge: 14,
    text: 'A young member of {rival} knocks on the door. Their family has held a grudge since {who} took them to court over a fence.',
    choices: [
      { label: 'Offer to make peace', outcomes: [o('They shook hands on the doorstep. Two families let go of an old quarrel.', { happiness: 6 }, { do: (c) => c.legacy.forget('rival') }), o('They would not take the hand. The grudge lives on.', { happiness: -3 })] },
      { label: 'Close the door', outcomes: [o('{name} closed the door. The feud went on another generation.', { happiness: -2 }, { later: { event: 'lx_feud_returns', years: [20, 35] } })] },
    ],
  },
  {
    id: 'lx_twins',
    category: 'family',
    stages: WORKING,
    minAge: 22,
    maxAge: 42,
    when: (ctx) => !!ctx.char.partner && ctx.char.children.length < 3,
    text: 'The doctor smiles: {name} and {partner} are expecting twins!',
    choices: [
      { label: 'Celebrate', outcomes: [o('Two cots, two names, half the sleep. {name} had never been happier.', { happiness: 8, health: -2, money: -500 }, { do: (c) => (c.addChild(), c.addChild()) })] },
    ],
  },
  {
    id: 'lx_elder_care',
    category: 'family',
    stages: ADULT,
    when: (ctx) => ['mother', 'father'].some((k) => ctx.char.family[k]?.alive && ctx.char.family[k].age >= 68),
    text: '{name}\'s ageing parent is struggling to manage alone.',
    choices: [
      { label: 'Move them in', outcomes: [o('The house got fuller and noisier, and the old stories came out every evening.', { happiness: 3, money: -400, rel: { mother: 8, father: 8 } })] },
      { label: 'Visit every Sunday', outcomes: [o('{name} visited every Sunday with a cake and the newspaper.', { happiness: 2, rel: { mother: 4, father: 4 } })] },
      { label: 'Pay for a nurse', outcomes: [o('A kind nurse looked after them. {name} paid, and worried a little less.', { money: -1200, happiness: 1 })] },
    ],
  },

  // ===== Political (when you or your family lead the town) ==========================================
  {
    id: 'lx_council_budget',
    category: 'political',
    leader: 'you',
    text: 'The town council is split: cut the school budget to fix the roads, or raise taxes to do both.',
    choices: [
      { label: 'Raise taxes', outcomes: [o('Taxes went up, and so did the grumbling, but the roads and the school were both fixed.', { happiness: -2 }, { town: { money: 600, spirit: [-0.02, 3] } })] },
      { label: 'Cut the school budget', outcomes: [o('The roads were patched. The teachers marched on the town hall.', { happiness: -3 }, { town: { money: 400, spirit: [-0.03, 4] } })] },
      { label: 'Find savings elsewhere', outcomes: [o('{name} trimmed the mayor\'s own expenses first. People noticed.', { happiness: 2, smarts: 1 }, { town: { spirit: [0.02, 3] } })] },
    ],
  },
  {
    id: 'lx_park_petition',
    category: 'political',
    leader: 'you',
    text: 'Two hundred names on a petition: the neighbourhood wants a new park.',
    choices: [
      { label: 'Fund it now', outcomes: [o('The town paid for new paths and benches. Children played there by summer.', { happiness: 3 }, { town: { money: -500, spirit: [0.04, 4] } })] },
      { label: 'Promise it for later', outcomes: [o('{name} promised the park "within a few years". The crowd went home hopeful.', { happiness: 1 }, { town: { spirit: [0.01, 2] }, later: { event: 'lx_promise_due', years: [3, 6] } })] },
      { label: 'Say no', outcomes: [o('The petition was filed away. So was some of the goodwill.', { happiness: -1 }, { town: { spirit: [-0.02, 3] } })] },
    ],
  },
  {
    id: 'lx_promise_due',
    category: 'political',
    scheduled: true,
    stages: ADULT,
    text: 'Years ago {who} promised the neighbourhood a park. People are asking where it is.',
    choices: [
      { label: 'Keep the promise', outcomes: [o('The park opened with a brass band. The old petition was framed by the gate.', { happiness: 4 }, { town: { money: -500, spirit: [0.05, 4] } })] },
      { label: 'Break it', outcomes: [o('The park never came. People remembered, and said so at every meeting.', { happiness: -3 }, { town: { spirit: [-0.04, 5] } })] },
    ],
  },
  {
    id: 'lx_bribe',
    category: 'political',
    leader: 'you',
    text: 'A builder slides an envelope across the desk: "for the mayor\'s trouble", if the new contract goes their way.',
    choices: [
      { label: 'Refuse it', outcomes: [o('{name} slid the envelope back. The builder left without a word.', { happiness: 2 })] },
      { label: 'Take it', outcomes: [o('The envelope went into {name}\'s coat pocket. It felt heavier than paper.', { money: 2000, happiness: -2 }, { later: { event: 'lx_scandal', years: [3, 8] } })] },
    ],
  },
  {
    id: 'lx_scandal',
    category: 'political',
    scheduled: true,
    stages: ADULT,
    text: 'A newspaper has found out about the builder\'s envelope {who} took years ago.',
    choices: [
      { label: 'Confess and repay it', outcomes: [o('{name} repaid every penny in public. Some trust came back.', { money: -2500, happiness: -3 }, { town: { spirit: [-0.02, 3] } })] },
      { label: 'Deny everything', outcomes: [o('The denial held, mostly. The whispers never quite stopped.', { happiness: -4 }, { town: { spirit: [-0.05, 5] } }), o('The builder confessed. The whole town knew by morning.', { happiness: -8 }, { town: { spirit: [-0.07, 6] } })] },
    ],
  },
  {
    id: 'lx_rival_candidate',
    category: 'political',
    leader: 'you',
    once: 'family',
    text: 'A sharp-tongued newcomer is telling everyone the town needs a new mayor.',
    choices: [
      { label: 'Challenge them to a debate', outcomes: [o('{name} won the debate in the town hall, to loud applause.', { happiness: 4, smarts: 1 }, { town: { spirit: [0.03, 3] } }), o('The newcomer was quicker on their feet. {name} went home thoughtful.', { happiness: -3 })] },
      { label: 'Ignore them', outcomes: [o('{name} got on with the job. The newcomer soon ran out of things to say.', { happiness: 1 })] },
      { label: 'Dig up dirt', outcomes: [o('The newcomer left town in disgrace, and swore their family would be back.', { happiness: -1 }, { do: (c) => c.legacy.remember('rival', 'the newcomer\'s family'), later: { event: 'lx_feud_returns', years: [20, 35] } })] },
    ],
  },
  {
    id: 'lx_strike',
    category: 'political',
    leader: 'you',
    eras: ['railway', 'motor', 'modern'],
    when: (ctx) => ctx.town.has('factory'),
    text: 'The factory workers have downed tools. They want shorter hours and fairer pay.',
    choices: [
      { label: 'Back the workers', outcomes: [o('The owners gave way. The workers carried {name} on their shoulders.', { happiness: 4 }, { town: { money: -300, spirit: [0.04, 4] } })] },
      { label: 'Back the owners', outcomes: [o('The strike broke after a cold week. The town was quiet, and not in a good way.', { happiness: -2 }, { town: { money: 300, spirit: [-0.04, 4] } })] },
      { label: 'Bring both sides together', outcomes: [o('{name} kept both sides at the table until dawn, and found a deal.', { smarts: 2, happiness: 2, health: -2 }, { town: { spirit: [0.02, 3] } })] },
    ],
  },
  {
    id: 'lx_mayors_kid',
    category: 'political',
    leader: 'family',
    stages: ['child', 'teen'],
    text: 'At school everyone knows {name}\'s family runs the town. A classmate asks {name} to "have a word" about getting a new playground.',
    choices: [
      { label: 'Ask at dinner', outcomes: [o('{name} asked at dinner. The playground got built, and {name} became a hero at school.', { happiness: 5 }, { town: { spirit: [0.01, 2] } })] },
      { label: 'Refuse to play favourites', outcomes: [o('{name} said no. The classmate sulked, but the teacher was impressed.', { smarts: 2, happiness: -1 })] },
    ],
  },
  {
    id: 'lx_learn_the_job',
    category: 'political',
    leader: 'family',
    stages: ['teen', 'young'],
    text: 'The mayor lets {name} sit in on a council meeting, to learn how the town is run.',
    choices: [
      { label: 'Take notes', outcomes: [o('{name} filled a notebook with how the town really works.', { smarts: 4 })] },
      { label: 'Speak up', outcomes: [o('{name}\'s idea about bus stops was adopted. The council chuckled, then agreed.', { happiness: 4, smarts: 2 }, { town: { spirit: [0.01, 2] } }), o('{name} spoke out of turn and was asked to wait outside.', { happiness: -3 })] },
    ],
  },

  // ===== Economic (by era) ==========================================================================
  {
    id: 'lx_gold_rumor',
    category: 'economic',
    eras: ['pioneer'],
    stages: WORKING,
    text: 'A rider gallops through town: gold in the hills, two days west!',
    choices: [
      { label: 'Join the rush', outcomes: [o('{name} came back with a small pouch of gold dust and terrible blisters.', { money: 1500, health: -3 }), o('{name} found nothing but rocks and a bad cold.', { money: -200, health: -4 })] },
      { label: 'Sell shovels to the miners', outcomes: [o('Every miner needed a shovel. {name} made money without leaving town.', { money: 900, smarts: 1 })] },
      { label: 'Stay put', outcomes: [o('{name} stayed home. Half of those who went came back poorer.', { happiness: 1 })] },
    ],
  },
  {
    id: 'lx_railway_shares',
    category: 'economic',
    eras: ['railway'],
    stages: WORKING,
    when: (ctx) => ctx.char.money >= 500,
    text: 'The new railway company is selling shares. Everyone at the station is talking about it.',
    choices: [
      { label: 'Buy shares', outcomes: [o('{name} bought railway shares and framed the certificate.', { money: -500 }, { later: { event: 'lx_shares_pay', years: [5, 10] } })] },
      { label: 'Keep the money', outcomes: [o('{name} kept the money under the mattress.', {})] },
    ],
  },
  {
    id: 'lx_shares_pay',
    category: 'economic',
    scheduled: true,
    text: 'News on the railway shares {who} bought years ago.',
    choices: [
      { label: 'Read the letter', outcomes: [o('The line was a roaring success. The shares were worth five times as much!', { money: 2500, happiness: 5 }, { weight: 2 }), o('The railway company went bust. The certificate is now just a nice frame.', { happiness: -3 })] },
    ],
  },
  {
    id: 'lx_motorcar',
    category: 'economic',
    eras: ['motor'],
    stages: WORKING,
    text: 'The dealer on the high street has a gleaming motorcar for sale.',
    choices: [
      { label: 'Buy it', outcomes: [o('{name} drove it home at a thrilling twelve miles an hour.', { money: -1500, happiness: 7, looks: 2 })] },
      { label: 'Sell the horse instead', outcomes: [o('The horse went to a farm with a meadow. {name} took the bus.', { money: 300, happiness: -1 })] },
    ],
  },
  {
    id: 'lx_market_boom',
    category: 'economic',
    eras: ['modern'],
    stages: WORKING,
    when: (ctx) => ctx.char.money >= 800,
    text: 'Stocks are booming. A colleague swears they doubled their savings in a month.',
    choices: [
      { label: 'Invest everything', outcomes: [o('{name} put every saved dollar into stocks.', { money: -800, happiness: 2 }, { later: { event: 'lx_market_crash', years: [2, 5], data: { all: true } } })] },
      { label: 'Invest a little', outcomes: [o('{name} put a little in, just to see.', { money: -200 }, { later: { event: 'lx_market_crash', years: [2, 5], data: { all: false } } })] },
      { label: 'Stay out', outcomes: [o('{name} stayed out. "If it sounds too good to be true…"', { smarts: 1 })] },
    ],
  },
  {
    id: 'lx_market_crash',
    category: 'economic',
    scheduled: true,
    text: 'The stock market has crashed overnight. What {who} invested is on the line.',
    choices: [
      {
        label: 'Check the damage',
        outcomes: [
          o('Everything {who} invested is gone. It will take years to recover.', { money: -200, happiness: -8, health: -2 }, { weight: echoIs('all', true) }),
          o('The little that was invested shrank, but {name} shrugs it off.', { happiness: -1 }, { weight: echoIs('all', false) }),
        ],
      },
    ],
  },
  {
    id: 'lx_solar_coop',
    category: 'economic',
    eras: ['future'],
    stages: ADULT,
    text: 'The street is forming a solar co-op: shared panels, shared savings.',
    choices: [
      { label: 'Join', outcomes: [o('Panels on every roof. The bills shrank and the street grew closer.', { money: -400, happiness: 4 }, { town: { spirit: [0.02, 4] } })] },
      { label: 'Not for now', outcomes: [o('{name} watched the panels go up on the neighbours\' roofs.', {})] },
    ],
  },
  {
    id: 'lx_family_shop',
    category: 'economic',
    stages: WORKING,
    once: 'family',
    when: (ctx) => ctx.char.money >= 1500,
    text: 'An empty shopfront on the high street. {name} could open a family business.',
    choices: [
      { label: 'Open the shop', outcomes: [o('"{last} & Family" opened on a Saturday. The first customer bought a pencil.', { money: -1500, happiness: 5 }, { do: (c) => c.legacy.remember('shop', true), later: { event: 'lx_shop_heir', years: [20, 32] } })] },
      { label: 'Stay employed', outcomes: [o('{name} kept the steady job and the steady pay.', {})] },
    ],
  },
  {
    id: 'lx_shop_heir',
    category: 'economic',
    scheduled: true,
    stages: ADULT,
    when: (ctx) => !!ctx.legacy.recall('shop'),
    text: 'The family shop {who} opened is still trading. Should {name} keep it going?',
    choices: [
      { label: 'Run the shop', outcomes: [o('{name} took over the counter. Regulars said it felt like old times.', { money: 1500, happiness: 4 })] },
      { label: 'Modernise it', outcomes: [o('New sign, new shelves, new customers. Business doubled.', { money: 2500, smarts: 1, happiness: 2 }), o('The new look scared off the old customers.', { money: -800, happiness: -3 })] },
      { label: 'Sell the business', outcomes: [o('The shop was sold. The old sign hangs in the hallway.', { money: 4000, happiness: -2 }, { do: (c) => c.legacy.forget('shop') })] },
    ],
  },

  // ===== Military (war and the base) ================================================================
  {
    id: 'lx_call_up',
    category: 'military',
    minAge: 18,
    maxAge: 45,
    when: (ctx) => ctx.town.atWar,
    text: 'With {neighbourtown} at war with {town}, posters ask for volunteers.',
    choices: [
      { label: 'Volunteer', outcomes: [o('{name} served at the base for a hard season and came home changed.', { health: -4, happiness: -2 }, { town: { soldierXp: 10 }, do: (c) => c.legacy.remember('veteran', `${c.char.first} ${c.char.last}`), later: { event: 'lx_veteran_reunion', years: [10, 20] } }), o('{name} came back with a limp and a medal.', { health: -10, happiness: 2 }, { town: { soldierXp: 15 }, later: { event: 'lx_veteran_reunion', years: [10, 20] } })] },
      { label: 'Work in the supply depot', outcomes: [o('{name} loaded crates for the front from dawn to dusk.', { health: -2, money: 300 }, { town: { soldierXp: 4 } })] },
      { label: 'Stay home', outcomes: [o('{name} kept the home fires burning.', { happiness: -1 })] },
    ],
  },
  {
    id: 'lx_veteran_reunion',
    category: 'military',
    scheduled: true,
    minAge: 10,
    text: 'The old regiment {who} served with is holding a reunion at the base.',
    choices: [
      { label: 'Go', outcomes: [o('Old soldiers told the same stories, louder every year. {name} listened to every one.', { happiness: 5 }, { town: { soldierXp: 5 } })] },
      { label: 'Send a letter instead', outcomes: [o('{name} sent a letter. It was read aloud to applause.', { happiness: 2 })] },
    ],
  },
  {
    id: 'lx_raid_night',
    category: 'military',
    minAge: 6,
    when: (ctx) => ctx.town.atWar,
    text: 'Bells ring in the night: raiders have been seen near {town}.',
    choices: [
      { label: 'Hide with the family', outcomes: [o('The family huddled in the cellar until the all-clear rang.', { happiness: -3, rel: { mother: 3, father: 3 } })] },
      { label: 'Carry water to the defenders', outcomes: [o('{name} ran buckets to the walls all night.', { health: -2, happiness: 3 }, { town: { soldierXp: 3 } })] },
    ],
  },
  {
    id: 'lx_peace_parade',
    category: 'military',
    once: true,
    when: (ctx) => !ctx.town.atWar && !!ctx.legacy.recall('sawWar'),
    text: 'The war is over! Bunting hangs across every street in {town}.',
    choices: [
      { label: 'Join the parade', outcomes: [o('{name} danced down the high street until the band ran out of tunes.', { happiness: 8 }, { town: { spirit: [0.03, 3] }, do: (c) => c.legacy.forget('sawWar') })] },
      { label: 'Visit the memorial', outcomes: [o('{name} laid flowers for those who did not come home.', { happiness: 2, smarts: 1 }, { do: (c) => c.legacy.forget('sawWar') })] },
    ],
  },
  {
    id: 'lx_war_letter',
    category: 'military',
    stages: ADULT,
    when: (ctx) => ctx.town.atWar && !!ctx.char.partner,
    text: 'A letter arrives in an army envelope. {name}\'s hands shake opening it.',
    choices: [
      { label: 'Read it', outcomes: [o('Good news: {partner} has been made a sergeant, and sends love.', { happiness: 4, rel: { partner: 5 } }, { weight: 3 }), o('{partner} is wounded, but will come home.', { happiness: -6, rel: { partner: 6 } })] },
    ],
  },
  {
    id: 'lx_review_troops',
    category: 'military',
    leader: 'any',
    minAge: 10,
    when: (ctx) => ctx.town.hasBase,
    text: 'The town\'s soldiers parade at the base, and the mayor\'s family is asked to review them.',
    choices: [
      { label: 'Give a speech', outcomes: [o('{name} spoke of courage and home. The soldiers stood a little taller.', { happiness: 3 }, { town: { soldierXp: 6 } })] },
      { label: 'Shake every hand', outcomes: [o('{name} shook every soldier\'s hand. It took all afternoon.', { happiness: 2, health: -1 }, { town: { soldierXp: 3, spirit: [0.01, 2] } })] },
    ],
  },
  {
    id: 'lx_envoy_dinner',
    category: 'military',
    leader: 'any',
    stages: ['teen', ...ADULT],
    when: (ctx) => ctx.town.hasBase,
    text: 'Envoys from {neighbourtown} are dining at the town hall, and {name} is seated beside them.',
    choices: [
      { label: 'Charm them', outcomes: [o('{name} made them laugh over dessert. Relations warmed.', { happiness: 2 }, { town: { trust: 6 } }), o('{name} told a joke about {neighbourtown}. It landed badly.', { happiness: -2 }, { town: { trust: -4 } })] },
      { label: 'Listen carefully', outcomes: [o('{name} listened more than talked, and learned a lot about {neighbourtown}.', { smarts: 3 }, { town: { trust: 2 } })] },
    ],
  },

  // ===== Social (by era and town) ===================================================================
  {
    id: 'lx_gas_lamps',
    category: 'social',
    eras: ['railway'],
    once: true,
    minAge: 4,
    text: 'The gas lamps are being lit along the high street for the very first time.',
    choices: [
      { label: 'Take an evening walk', outcomes: [o('{name} walked under the new lamps until late. The town looked like a painting.', { happiness: 5 })] },
      { label: 'Help the lamplighter', outcomes: [o('The lamplighter let {name} light the last lamp on the street.', { happiness: 4, smarts: 1 })] },
    ],
  },
  {
    id: 'lx_first_motorcar',
    category: 'social',
    eras: ['motor'],
    once: true,
    minAge: 4,
    text: 'A motorcar rattles down the street, scattering chickens. Everyone runs out to look.',
    choices: [
      { label: 'Chase it', outcomes: [o('{name} chased it to the end of the road, laughing.', { happiness: 5, health: 1 })] },
      { label: 'Ask for a ride', outcomes: [o('The driver gave {name} a ride round the square. Unforgettable.', { happiness: 7 }), o('The driver honked and sped off.', { happiness: -1 })] },
    ],
  },
  {
    id: 'lx_radio_night',
    category: 'social',
    eras: ['motor', 'modern'],
    minAge: 5,
    text: 'The whole street gathers around one radio for the big broadcast.',
    choices: [
      { label: 'Listen with the neighbours', outcomes: [o('Squashed on a neighbour\'s sofa, everyone gasped at the same moments.', { happiness: 4 }, { do: (c) => c.addFriend(45) })] },
      { label: 'Read instead', outcomes: [o('{name} read by lamplight while the street cheered outside.', { smarts: 2 })] },
    ],
  },
  {
    id: 'lx_tower_opening',
    category: 'social',
    eras: ['modern', 'future'],
    once: true,
    minAge: 6,
    when: (ctx) => ctx.town.has('tower'),
    text: 'The new tower is opening, and the top floor is open to everyone for one day.',
    choices: [
      { label: 'Go up', outcomes: [o('From the top, {name} could see the whole of {town}, and the hills beyond.', { happiness: 6 })] },
      { label: 'Stay on the ground', outcomes: [o('{name} watched the little faces at the top windows from far below.', { happiness: 1 })] },
    ],
  },
  {
    id: 'lx_town_fair',
    category: 'social',
    minAge: 6,
    when: (ctx) => ctx.town.population >= 40,
    text: 'The {town} fair is here! There is a pie contest, a tug-of-war and a talent show.',
    choices: [
      { label: 'Enter the pie contest', outcomes: [o('{name}\'s pie won a blue ribbon!', { happiness: 6 }), o('{name}\'s pie was described as "brave".', { happiness: -1 })] },
      { label: 'Join the tug-of-war', outcomes: [o('{name}\'s team won, and fell over in a heap.', { happiness: 4, health: 2 })] },
      { label: 'Sing in the talent show', outcomes: [o('{name} sang, and the crowd sang along.', { happiness: 5, looks: 2 }), o('{name} forgot the words, and the crowd hummed along kindly.', { happiness: 1 })] },
    ],
  },
  {
    id: 'lx_newcomers',
    category: 'social',
    stages: ['teen', ...ADULT],
    when: (ctx) => ctx.town.happiness >= 55,
    text: 'A cart of newcomers has arrived in {town}, looking for somewhere to start again.',
    choices: [
      { label: 'Welcome them with a meal', outcomes: [o('{name} cooked for the newcomers. They became friends for life.', { happiness: 4, money: -50 }, { do: (c) => c.addFriend(60), town: { spirit: [0.01, 2] } })] },
      { label: 'Keep to yourself', outcomes: [o('{name} nodded politely and kept walking.', {})] },
    ],
  },
  {
    id: 'lx_epidemic',
    category: 'social',
    minAge: 8,
    when: (ctx) => ctx.facts.clinicCoverage < 0.25,
    text: 'A fever is spreading through {town}, and there is no clinic nearby. (Building a clinic near home would help.)',
    choices: [
      { label: 'Help nurse the sick', outcomes: [o('{name} carried soup and medicine door to door. People still remember.', { health: -4, happiness: 3 }, { town: { spirit: [0.02, 3] } }), o('{name} caught the fever, but pulled through.', { health: -10, happiness: -2 })] },
      { label: 'Stay inside', outcomes: [o('{name} stayed in and stayed well.', { happiness: -2 })] },
    ],
  },
  {
    id: 'lx_unemployment',
    category: 'social',
    stages: WORKING,
    when: (ctx) => ctx.town.population > 20 && ctx.town.employment < 0.8,
    text: 'Too many people in {town} are out of work. The queue at the soup kitchen stretches round the block.',
    choices: [
      { label: 'Volunteer at the kitchen', outcomes: [o('{name} ladled soup every Saturday through the hard months.', { happiness: 3 }, { town: { spirit: [0.01, 3] } })] },
      { label: 'Donate money', outcomes: [o('{name} gave what could be spared.', { money: -200, happiness: 2 }, { town: { spirit: [0.01, 2] } })] },
    ],
  },
  {
    id: 'lx_garden_city',
    category: 'social',
    eras: ['future'],
    stages: ADULT,
    text: 'The street votes on turning the old car park into a rooftop garden.',
    choices: [
      { label: 'Vote yes and dig in', outcomes: [o('Tomatoes, beehives and benches where the cars used to be.', { happiness: 5, health: 2 }, { town: { spirit: [0.02, 4] } })] },
      { label: 'Vote no', outcomes: [o('The car park stayed. So did the parking.', {})] },
    ],
  },
];

// Legacy events come back to the same person at most every 12 years unless they say otherwise.
for (const ev of LEGACY_EVENTS) if (!ev.once && !ev.scheduled && ev.cooldown == null) ev.cooldown = 12;
