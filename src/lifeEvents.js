// Life Story events. Each event: when it can happen (stages, ages, `when`), its text, and choices.
// A choice has weighted outcomes; an outcome has text and effects (stats, money, closeness, flags),
// plus optional `do(ctx)` for changes like a new friend or job, and `next` to chain another event.
// Text placeholders: {name} {fullname} {their} {them} {mother} {father} {friend} {partner} {child}
// {sibling} {job} {workplace} {money} {neighbour} {neighbourperson} {nspot}.
// Write sentences with {name} as the subject so every pronoun reads naturally.

import { STRUCTURES } from './config.js';
import { CAREERS } from './lifeData.js';
import { addressOf } from './streets.js';
import { MORE_EVENTS } from './lifeEventsMore.js';
import { LEGACY_EVENTS } from './legacyEvents.js';

const o = (text, effects = {}, extra = {}) => ({ text, effects, ...extra });

const place = (t) => `the ${STRUCTURES[t.structure.type].label.toLowerCase()} at ${addressOf(t)}`;

export const LIFE_EVENTS = [
  // ---- Baby ---------------------------------------------------------------
  {
    id: 'first_word',
    stages: ['baby'],
    once: true,
    text: '{name} has been babbling all week. At breakfast, a real word is on the way.',
    choices: [
      { label: 'Say "Mama"', outcomes: [o('{name} said "Mama", and {mother} cried happy tears.', { happiness: 4, rel: { mother: 10 } })] },
      { label: 'Say "Dada"', outcomes: [o('{name} said "Dada". {father} told everyone on the street.', { happiness: 4, rel: { father: 10 } })] },
      { label: 'Say "Duck"', outcomes: [o('{name}\'s first word was "duck". Nobody knows why.', { happiness: 6, smarts: 2 })] },
    ],
  },
  {
    id: 'night_owl',
    stages: ['baby'],
    text: 'It is 3 a.m. and {name} is wide awake.',
    choices: [
      { label: 'Cry for a cuddle', outcomes: [o('{father} rocked {name} back to sleep, yawning.', { happiness: 3, rel: { father: 4 } })] },
      { label: 'Babble at the ceiling', outcomes: [o('{name} chatted to the ceiling until sunrise.', { smarts: 2 })] },
    ],
  },
  {
    id: 'pram_park',
    stages: ['baby'],
    when: (ctx) => ctx.facts.greenery > 0.1,
    text: 'The family takes {name} for a stroll in the park near home.',
    choices: [
      { label: 'Giggle at the ducks', outcomes: [o('{name} giggled at the ducks the whole way round.', { happiness: 6, health: 2 })] },
      { label: 'Nap in the pram', outcomes: [o('{name} slept soundly under the trees.', { health: 4 })] },
    ],
  },

  // ---- Child --------------------------------------------------------------
  {
    id: 'first_school_day',
    stages: ['child'],
    minAge: 5,
    maxAge: 7,
    once: true,
    when: (ctx) => ctx.facts.schoolCoverage > 0.25,
    text: 'First day at school! {name} stands at the gate clutching a new backpack.',
    choices: [
      { label: 'Hold {mother}\'s hand', outcomes: [o('{name} held on tight, then waved goodbye at the door.', { happiness: 3, rel: { mother: 6 } })] },
      {
        label: 'Run straight in',
        outcomes: [
          o('{name} ran in and made a friend before the bell rang.', { happiness: 6 }, { weight: (c) => (c.has('outgoing') ? 3 : 1), do: (c) => c.addFriend(60) }),
          o('{name} ran in, tripped over a backpack and laughed it off.', { happiness: 2 }),
        ],
      },
      { label: 'Hide behind the gate', outcomes: [o('A kind teacher coaxed {name} inside with a sticker.', { happiness: -2, smarts: 1 })] },
    ],
  },
  {
    id: 'no_school',
    stages: ['child'],
    minAge: 6,
    maxAge: 8,
    once: true,
    when: (ctx) => ctx.facts.schoolCoverage <= 0.25,
    title: 'No school nearby',
    text: 'There is no school close to home, so {mother} sets up lessons at the kitchen table. (Building a school near {name}\'s home would help.)',
    choices: [
      { label: 'Study hard', outcomes: [o('{name} worked through every workbook.', { smarts: 4, happiness: -2 })] },
      { label: 'Daydream out of the window', outcomes: [o('{name} learned the names of every bird outside instead.', { happiness: 3, smarts: 1 })] },
    ],
  },
  {
    id: 'playground_friend',
    stages: ['child'],
    cooldown: 3,
    text: 'A kid at the playground asks {name} to play.',
    choices: [
      { label: 'Play tag', outcomes: [o('{name} and a new friend played tag until dark.', { happiness: 5, health: 2 }, { do: (c) => c.addFriend(55) })] },
      { label: 'Share a snack', outcomes: [o('{name} shared a snack and made a friend for life.', { happiness: 4 }, { do: (c) => c.addFriend(65) })] },
      {
        label: 'Stay shy',
        outcomes: [
          o('{name} stayed by the slide and watched.', { happiness: -2 }),
          o('{name} was shy, but the kid came over anyway.', { happiness: 3 }, { do: (c) => c.addFriend(45) }),
        ],
      },
    ],
  },
  {
    id: 'puppy',
    stages: ['child'],
    once: true,
    text: '{name} has seen a puppy in the shop window and really, really wants one.',
    choices: [
      {
        label: 'Beg {father}',
        outcomes: [
          o('{father} gave in. Welcome home, Biscuit the puppy!', { happiness: 10, set: ['pet'] }, { weight: 2 }),
          o('{father} said not this year.', { happiness: -4 }),
        ],
      },
      { label: 'Promise to walk it every day', outcomes: [o('The promise worked. Biscuit the puppy joins the family.', { happiness: 10, health: 2, set: ['pet'] })] },
      { label: 'Draw a picture of it instead', outcomes: [o('{name}\'s puppy drawing went on the fridge.', { happiness: 2, smarts: 1 })] },
    ],
  },
  {
    id: 'loose_tooth',
    stages: ['child'],
    once: true,
    text: '{name}\'s wobbly tooth finally came out at dinner.',
    choices: [
      { label: 'Put it under the pillow', outcomes: [o('The tooth fairy left $5.', { money: 5, happiness: 4 })] },
      { label: 'Keep it in a jar', outcomes: [o('{name} started a tooth collection. Slightly worrying.', { happiness: 2, smarts: 1 })] },
    ],
  },
  {
    id: 'science_fair',
    stages: ['child', 'teen'],
    minAge: 8,
    maxAge: 14,
    when: (ctx) => ctx.facts.schoolCoverage > 0.25,
    text: 'The school science fair is next week.',
    choices: [
      {
        label: 'Build a baking-soda volcano',
        outcomes: [o('The volcano erupted all over the judges. Third place!', { smarts: 3, happiness: 4 }), o('The volcano fizzled. Next year.', { smarts: 2 })],
      },
      {
        label: 'Make a solar oven',
        outcomes: [
          o('{name}\'s solar oven baked a cookie. First prize!', { smarts: 6, happiness: 6 }, { weight: (c) => 1 + c.char.stats.smarts / 40 }),
          o('Cloudy day. The oven made a warm cookie at best.', { smarts: 3 }),
        ],
      },
      { label: 'Skip it', outcomes: [o('{name} spent the week playing outside.', { happiness: 2, smarts: -1 })] },
    ],
  },
  {
    id: 'chickenpox',
    stages: ['child'],
    once: true,
    text: '{name} has woken up covered in itchy spots. Chickenpox.',
    choices: [
      {
        label: 'Rest and drink soup',
        outcomes: [
          o('The clinic nearby helped {name} feel better within days.', { health: -2 }, { weight: (c) => (c.facts.clinicCoverage > 0.25 ? 4 : 0.5) }),
          o('{name} rested for two long weeks.', { health: -6 }),
        ],
      },
      { label: 'Scratch everything', outcomes: [o('{name} scratched and now has a tiny scar.', { health: -6, looks: -2 })] },
    ],
  },
  {
    id: 'learn_bike',
    stages: ['child'],
    minAge: 5,
    maxAge: 10,
    once: true,
    text: '{father} is teaching {name} to ride a bike.',
    choices: [
      {
        label: 'Keep trying',
        outcomes: [
          o('After three wobbly falls, {name} rode the length of the street!', { health: 4, happiness: 6, set: ['bike'] }),
          o('The street is busy with traffic, so lessons moved to the park. {name} got there in the end.', { health: 3, happiness: 3, set: ['bike'] }, { weight: (c) => c.facts.commuteJam * 2 }),
        ],
      },
      { label: 'Give up for now', outcomes: [o('The bike went back in the shed.', { happiness: -3 })] },
    ],
  },
  {
    id: 'school_play',
    stages: ['child'],
    minAge: 7,
    when: (ctx) => ctx.facts.schoolCoverage > 0.25,
    text: 'Auditions for the school play!',
    choices: [
      {
        label: 'Try for the lead',
        outcomes: [
          o('{name} got the lead and the whole family came to watch.', { happiness: 8, looks: 2 }, { weight: (c) => (c.has('creative') ? 3 : 1) }),
          o('{name} got cast as a tree. A very convincing tree.', { happiness: 2 }),
        ],
      },
      { label: 'Join the stage crew', outcomes: [o('{name} painted the castle backdrop.', { smarts: 2, happiness: 3 })] },
    ],
  },
  {
    id: 'climbing_dare',
    stages: ['child'],
    text: 'Some older kids dare {name} to climb the tallest tree in the park.',
    when: (ctx) => ctx.facts.greenery > 0.05,
    choices: [
      {
        label: 'Climb it',
        outcomes: [o('{name} reached the top and waved like a champion.', { happiness: 6, health: 2 }, { weight: 2 }), o('{name} slipped and sprained a wrist.', { health: -8, happiness: -3 })],
      },
      { label: 'Say no thanks', outcomes: [o('{name} walked away. Sensible.', { smarts: 1 })] },
    ],
  },

  // ---- Teen ---------------------------------------------------------------
  {
    id: 'weekend_job',
    stages: ['teen'],
    minAge: 15,
    once: true,
    when: (ctx) => ctx.openJobs().some((t) => t.structure.type === 'shop'),
    text: 'A shop in town has a sign in the window: weekend help wanted.',
    choices: [
      { label: 'Apply', outcomes: [o('{name} got the job and the first pay packet felt amazing.', { money: 400, happiness: 4, smarts: -1, set: ['partTime'] })] },
      { label: 'Keep weekends free', outcomes: [o('{name} spent weekends with friends instead.', { happiness: 3 })] },
    ],
  },
  {
    id: 'exam_week',
    stages: ['teen'],
    cooldown: 2,
    text: 'Exams start on Monday.',
    choices: [
      { label: 'Study every evening', outcomes: [o('{name} aced the exams.', { smarts: 5, happiness: -1 }, { weight: 3 }), o('{name} studied hard but blanked on the day.', { smarts: 2, happiness: -3 })] },
      { label: 'Cram the night before', outcomes: [o('{name} scraped through.', { smarts: 2, health: -2 }), o('Cramming did not go well.', { smarts: -1, happiness: -3 })] },
      { label: 'Go to a party instead', outcomes: [o('Great party. Terrible results.', { happiness: 4, smarts: -4 })] },
    ],
  },
  {
    id: 'crush',
    stages: ['teen'],
    once: true,
    text: '{name} has a crush on someone in class.',
    choices: [
      {
        label: 'Ask them out',
        outcomes: [
          o('They said yes! Milkshakes after school became a thing.', { happiness: 10 }, { weight: (c) => 1 + c.char.stats.looks / 60 }),
          o('They said they just want to be friends.', { happiness: -6 }, { do: (c) => c.addFriend(50) }),
        ],
      },
      { label: 'Pass a note', outcomes: [o('The note got intercepted by a teacher. Mortifying.', { happiness: -4 }), o('The reply said "me too". {name} floated home.', { happiness: 8 })] },
      { label: 'Keep it secret', outcomes: [o('{name} kept the secret and wrote a lot of poetry.', { happiness: -1, smarts: 1 })] },
    ],
  },
  {
    id: 'band',
    stages: ['teen'],
    once: true,
    text: '{friend} is starting a band and needs one more member.',
    choices: [
      { label: 'Play guitar', outcomes: [o('{name} learned four chords and played a gig at the community hall.', { happiness: 7, looks: 2, rel: { friend: 8 } }, { weight: (c) => (c.has('creative') ? 3 : 1) }), o('Practice was fun, the gig was loud.', { happiness: 4, rel: { friend: 5 } })] },
      { label: 'Play drums', outcomes: [o('The neighbours were not fans, but {name} loved it.', { happiness: 6, health: 2, rel: { friend: 6 } })] },
      { label: 'Say no', outcomes: [o('{name} came to every gig as their biggest fan.', { rel: { friend: 3 } })] },
    ],
  },
  {
    id: 'curfew',
    stages: ['teen'],
    text: 'Everyone is going to a late concert, but curfew is at ten.',
    choices: [
      { label: 'Sneak out', outcomes: [o('Best night ever, and nobody noticed.', { happiness: 6 }), o('{mother} was waiting up. Grounded for a month.', { happiness: -6, rel: { mother: -8 } }, { weight: 1.2 })] },
      { label: 'Ask for an exception', outcomes: [o('{father} said yes, as long as {name} texted on the way home.', { happiness: 5, rel: { father: 5 } }), o('The answer was no.', { happiness: -3 })] },
      { label: 'Stay home', outcomes: [o('{name} watched the concert online with snacks.', { happiness: 1, rel: { mother: 3 } })] },
    ],
  },
  {
    id: 'driving_test',
    stages: ['teen', 'young'],
    minAge: 17,
    maxAge: 25,
    when: (ctx) => !ctx.char.flags.license,
    text: '{name}\'s driving test is booked.',
    choices: [
      {
        label: 'Practise for weeks',
        outcomes: [
          o('Passed first time!', { happiness: 6, set: ['license'] }, { weight: 3 }),
          o('A traffic jam downtown made {name} nervous. Failed, but close.', { happiness: -4 }, { weight: (c) => 1 + c.facts.commuteJam * 3 }),
        ],
      },
      { label: 'Wing it', outcomes: [o('{name} passed, somehow.', { happiness: 5, set: ['license'] }), o('{name} failed after forgetting to signal.', { happiness: -5 }, { weight: 2 })] },
    ],
  },
  {
    id: 'sports_trials',
    stages: ['teen'],
    text: 'Trials for the school sports team are on Friday.',
    choices: [
      { label: 'Try out', outcomes: [o('{name} made the team!', { health: 6, happiness: 5 }, { weight: (c) => (c.has('sporty') ? 3 : 1) }), o('{name} didn\'t make it, but got a lot fitter.', { health: 3, happiness: -2 })] },
      { label: 'Sit it out', outcomes: [o('{name} cheered from the stands.', { happiness: 1 })] },
    ],
  },
  {
    id: 'graduation',
    stages: ['teen', 'young'],
    minAge: 17,
    maxAge: 19,
    once: true,
    text: 'It\'s graduation day for {name}.',
    choices: [
      { label: 'Celebrate with friends', outcomes: [o('{name} threw a cap in the air and partied till dawn.', { happiness: 8, set: ['graduated'] })] },
      { label: 'Quiet dinner with family', outcomes: [o('{mother} and {father} beamed all through dinner.', { happiness: 5, rel: { mother: 6, father: 6 }, set: ['graduated'] })] },
    ],
  },

  // ---- Young adult --------------------------------------------------------
  {
    id: 'move_out',
    stages: ['young'],
    minAge: 18,
    weight: 3,
    cooldown: 2,
    when: (ctx) => ctx.char.livesWithParents,
    title: 'Time to move out?',
    text: '{name} is thinking about getting a place of {their} own. These homes in the city have room:',
    choices: (ctx) => [
      ...ctx
        .openHomes()
        .slice(0, 3)
        .map((t) => ({ label: `${STRUCTURES[t.structure.type].label} at ${addressOf(t)} · ${Math.round(t.desirability * 100)}% desirable`, data: { x: t.x, y: t.y } })),
      { label: 'Stay with {mother} and {father} a while longer', data: null },
    ],
    outcome: (ctx, data) => {
      if (!data) return o('{name} stayed home and saved money on rent.', { money: 2000, happiness: -1 });
      const t = ctx.city.getTile(data.x, data.y);
      if (!t?.structure || !STRUCTURES[t.structure.type].capacity) return o('That place was gone by the time {name} called.', { happiness: -3 });
      return o(`{name} moved into ${place(t)}. Freedom!`, { happiness: 6 + Math.round(t.desirability * 6) }, { do: (c) => c.moveTo(t) });
    },
  },
  {
    id: 'job_hunt',
    stages: ['young', 'adult'],
    minAge: 18,
    maxAge: 62,
    weight: 4,
    cooldown: 1,
    when: (ctx) => !ctx.char.job,
    title: 'Looking for work',
    text: '{name} is looking for a job. These workplaces in the city are hiring:',
    choices: (ctx) => {
      const jobs = ctx.openJobs();
      const seenTypes = new Set();
      const picks = [];
      for (const t of jobs) {
        if (seenTypes.has(t.structure.type)) continue;
        seenTypes.add(t.structure.type);
        const career = CAREERS[t.structure.type];
        picks.push({ label: `${career.titles[0]} at ${place(t)} · $${career.pay[0].toLocaleString()}/yr`, data: { x: t.x, y: t.y } });
        if (picks.length === 3) break;
      }
      return [...picks, { label: picks.length ? 'Keep looking' : 'Nothing is hiring. Wait and see', data: null }];
    },
    outcome: (ctx, data, rng) => {
      if (!data) {
        return ctx.openJobs().length
          ? o('{name} decided to hold out for something better.', { happiness: -2 })
          : o('No one in town is hiring. (Shops, offices, schools and clinics create jobs.)', { happiness: -5 });
      }
      const t = ctx.city.getTile(data.x, data.y);
      const career = t?.structure && CAREERS[t.structure.type];
      if (!career) return o('That workplace closed before the interview.', { happiness: -3 });
      const need = career.smarts;
      const odds = Math.min(0.95, 0.35 + (ctx.char.stats.smarts - need) / 50 + (ctx.char.flags.graduated ? 0.15 : 0));
      if (rng() < odds) return o(`{name} got the job as ${career.titles[0].toLowerCase()} at ${place(t)}!`, { happiness: 8 }, { do: (c) => c.takeJob(t) });
      return o(`The ${STRUCTURES[t.structure.type].label.toLowerCase()} went with someone else. ${need ? 'More Smarts would help.' : ''}`, { happiness: -4 });
    },
  },
  {
    id: 'promotion',
    stages: ['young', 'adult'],
    when: (ctx) => ctx.char.job && ctx.char.job.years >= 2 && ctx.char.job.level < CAREERS[ctx.char.job.type].titles.length - 1,
    cooldown: 3,
    text: 'A senior role has opened up at the {workplace}.',
    choices: [
      {
        label: 'Work late for weeks to earn it',
        outcomes: [
          o('{name} got the promotion!', { happiness: 6, health: -3 }, { weight: (c) => 1 + c.char.stats.smarts / 50, do: (c) => (c.char.job.level += 1, (c.char.job.years = 0)) }),
          o('Someone else got it. {name} is exhausted.', { happiness: -5, health: -3 }),
        ],
      },
      {
        label: 'Ask the boss directly',
        outcomes: [
          o('Bold move. It worked!', { happiness: 7 }, { weight: (c) => (c.has('outgoing') ? 2 : 1), do: (c) => (c.char.job.level += 1, (c.char.job.years = 0)) }),
          o('The boss said "maybe next year".', { happiness: -2 }),
        ],
      },
      { label: 'Stay where {name} is', outcomes: [o('{name} likes the current role just fine.', { happiness: 2 })] },
    ],
  },
  {
    id: 'commute_jam',
    stages: ['young', 'adult'],
    when: (ctx) => ctx.char.job && ctx.facts.commuteJam > 0.5,
    cooldown: 2,
    title: 'Stuck in traffic',
    text: 'The roads near {name}\'s commute are jammed again. (More roads or nearby jobs would ease it.)',
    choices: [
      { label: 'Leave an hour earlier', outcomes: [o('{name} beat the traffic but misses sleep.', { health: -3 })] },
      { label: 'Cycle instead', outcomes: [o('{name} breezed past the queues.', { health: 5, happiness: 3 }), o('{name} got caught in the rain.', { health: 2, happiness: -2 })] },
      { label: 'Complain to the city', outcomes: [o('The city said it is "looking into it".', { happiness: -3 })] },
    ],
  },
  {
    id: 'blind_date',
    stages: ['young', 'adult'],
    maxAge: 50,
    when: (ctx) => !ctx.char.partner,
    cooldown: 2,
    text: '{friend} wants to set {name} up on a blind date.',
    choices: [
      {
        label: 'Go for it',
        outcomes: [
          o('Sparks flew! {name} has a new partner.', { happiness: 10 }, { weight: (c) => 1 + c.char.stats.looks / 70 + (c.has('outgoing') ? 0.5 : 0), do: (c) => c.setPartner(60) }),
          o('Awkward silence over pasta. Never again.', { happiness: -3 }),
        ],
      },
      { label: 'Not interested', outcomes: [o('{name} enjoyed a quiet night in.', { happiness: 1 })] },
    ],
  },
  {
    id: 'move_in_together',
    stages: ['young', 'adult'],
    once: true,
    when: (ctx) => ctx.char.partner && ctx.char.partner.closeness > 65,
    text: '{partner} asks if {name} wants to move in together.',
    choices: [
      { label: 'Yes!', outcomes: [o('{name} and {partner} moved in together.', { happiness: 8, rel: { partner: 10 } }, { do: (c) => (c.char.livesWithParents = false) })] },
      { label: 'Not yet', outcomes: [o('{partner} was a bit hurt but understood.', { rel: { partner: -6 } })] },
    ],
  },
  {
    id: 'gym',
    stages: ['young', 'adult'],
    cooldown: 5,
    text: '{name} wants to get fitter.',
    choices: [
      { label: 'Join a gym ($600)', outcomes: [o('{name} went three times a week, mostly.', { health: 6, looks: 2, money: -600 })] },
      {
        label: 'Run in the park',
        outcomes: [
          o('Morning runs under the trees became a habit.', { health: 7, happiness: 3 }, { weight: (c) => (c.facts.greenery > 0.1 ? 3 : 0.3) }),
          o('No park nearby, so {name} ran along busy roads. Not so pleasant.', { health: 3, happiness: -2 }),
        ],
      },
      { label: 'Maybe next year', outcomes: [o('{name} bought trainers and admired them.', { happiness: 1 })] },
    ],
  },
  {
    id: 'holiday',
    stages: ['young', 'adult', 'senior'],
    cooldown: 3,
    when: (ctx) => ctx.char.money > 1500,
    text: '{name} has some savings and could use a break.',
    choices: [
      { label: 'Beach trip ($1,500)', outcomes: [o('Sun, sea and a lot of ice cream.', { happiness: 10, money: -1500 })] },
      { label: 'Mountain hike ($1,000)', outcomes: [o('{name} reached the summit at sunrise.', { happiness: 7, health: 4, money: -1000 })] },
      { label: 'Stay home and save', outcomes: [o('{name} explored the city like a tourist.', { happiness: 3 })] },
    ],
  },
  {
    id: 'old_friend',
    stages: ['young', 'adult', 'senior'],
    cooldown: 6,
    text: 'An old friend from school messages {name} out of the blue.',
    choices: [
      { label: 'Meet for coffee', outcomes: [o('It was like no time had passed.', { happiness: 6 }, { do: (c) => c.addFriend(60) })] },
      { label: 'Leave it on read', outcomes: [o('{name} let the past stay in the past.', { happiness: -1 })] },
    ],
  },
  {
    id: 'adopt_cat',
    stages: ['young', 'adult'],
    once: true,
    text: 'A stray cat keeps showing up at {name}\'s door.',
    choices: [
      { label: 'Adopt it', outcomes: [o('Meet Pickles, the new boss of the house.', { happiness: 8, set: ['cat'] })] },
      { label: 'Find its owner', outcomes: [o('The owner lived two streets away and brought cake.', { happiness: 4 }, { do: (c) => c.addFriend(50) })] },
    ],
  },

  // ---- Adult --------------------------------------------------------------
  {
    id: 'proposal',
    stages: ['young', 'adult'],
    once: true,
    when: (ctx) => ctx.char.partner && !ctx.char.partner.married && ctx.char.partner.closeness > 70,
    text: '{name} and {partner} have been together a long time.',
    choices: [
      {
        label: 'Propose',
        outcomes: [
          o('{partner} said yes! The wedding was in the park.', { happiness: 12, money: -3000, rel: { partner: 12 } }, { weight: 4, do: (c) => (c.char.partner.married = true) }),
          o('{partner} wants to wait a little longer.', { happiness: -5 }),
        ],
      },
      { label: 'Wait', outcomes: [o('No rush.', { rel: { partner: -2 } })] },
    ],
  },
  {
    id: 'new_baby',
    stages: ['young', 'adult'],
    minAge: 24,
    maxAge: 44,
    cooldown: 3,
    when: (ctx) => ctx.char.partner && ctx.char.partner.closeness > 60 && ctx.char.children.length < 3,
    text: '{name} and {partner} are talking about a baby.',
    choices: [
      { label: 'Start a family', outcomes: [o('Welcome to the world, {child}!', { happiness: 12, health: -2, money: -2000 }, { do: (c) => c.addChild() })] },
      { label: 'Not now', outcomes: [o('{name} and {partner} decided to wait.', {})] },
    ],
  },
  {
    id: 'career_change',
    stages: ['adult'],
    cooldown: 8,
    when: (ctx) => ctx.char.job && ctx.char.job.years >= 4 && ctx.openJobs().some((t) => t.structure.type !== ctx.char.job.type),
    text: '{name} is bored of being a {job}. Something new is tempting.',
    choices: (ctx) => [
      ...ctx
        .openJobs()
        .filter((t) => t.structure.type !== ctx.char.job.type)
        .slice(0, 2)
        .map((t) => ({ label: `Retrain for ${place(t)}`, data: { x: t.x, y: t.y } })),
      { label: 'Stay put', data: null },
    ],
    outcome: (ctx, data, rng) => {
      if (!data) return o('{name} stayed in the same job, and that is fine.', { happiness: -1 });
      const t = ctx.city.getTile(data.x, data.y);
      const career = t?.structure && CAREERS[t.structure.type];
      if (!career) return o('That opening vanished.', {});
      if (rng() < 0.4 + (ctx.char.stats.smarts - career.smarts) / 60) return o(`{name} started fresh as ${career.titles[0].toLowerCase()} at ${place(t)}.`, { happiness: 8, money: -1000 }, { do: (c) => c.takeJob(t) });
      return o('The retraining course was full this year.', { happiness: -3 });
    },
  },
  {
    id: 'hobby',
    stages: ['adult'],
    cooldown: 6,
    text: '{name} wants a new hobby.',
    choices: [
      { label: 'Painting', outcomes: [o('{name}\'s watercolours of the city skyline sold at a fair.', { happiness: 6, money: 300 }, { weight: (c) => (c.has('creative') ? 3 : 1) }), o('{name} enjoys painting, even if nobody else does.', { happiness: 4 })] },
      { label: 'Train for a marathon', outcomes: [o('{name} finished the city marathon!', { health: 8, happiness: 6 }), o('A twisted ankle ended training early.', { health: -4 })] },
      { label: 'Cooking classes', outcomes: [o('{name}\'s lasagne is now famous on the street.', { happiness: 5 }, { do: (c) => c.addFriend(45) })] },
    ],
  },
  {
    id: 'parent_ill',
    stages: ['adult'],
    once: true,
    when: (ctx) => (ctx.char.family.mother?.alive || ctx.char.family.father?.alive) && ctx.char.age > 34,
    text: '{name}\'s parent hasn\'t been well lately.',
    choices: [
      {
        label: 'Visit every weekend',
        outcomes: [o('The visits meant the world.', { happiness: 2, rel: { mother: 10, father: 10 } }, { weight: (c) => (c.facts.clinicCoverage > 0.25 ? 3 : 1) }), o('It was a hard year, but they got through it together.', { happiness: -3, rel: { mother: 8, father: 8 } })],
      },
      { label: 'Send flowers', outcomes: [o('Lovely flowers. They wished {name} would visit.', { rel: { mother: -3, father: -3 } })] },
    ],
  },
  {
    id: 'park_petition',
    stages: ['adult', 'senior'],
    once: true,
    when: (ctx) => ctx.facts.greenery < 0.08,
    title: 'Not much green around here',
    text: 'There are hardly any trees or parks near {name}\'s home. (Planting trees or a park nearby would cheer everyone up.)',
    choices: [
      { label: 'Start a petition', outcomes: [o('Half the street signed {name}\'s petition.', { happiness: 3 }, { do: (c) => c.addFriend(45) })] },
      { label: 'Grow plants on the balcony', outcomes: [o('{name}\'s balcony is now a tiny jungle.', { happiness: 4 })] },
    ],
  },
  {
    id: 'lottery',
    stages: ['young', 'adult', 'senior'],
    cooldown: 5,
    text: 'The corner shop is selling lottery tickets for $10.',
    choices: [
      {
        label: 'Buy one',
        outcomes: [o('Not a winner.', { money: -10 }, { weight: 18 }), o('{name} won $500!', { money: 490, happiness: 6 }, { weight: 2 }), o('Jackpot! {name} won $50,000!', { money: 49990, happiness: 20 }, { weight: 0.15 })],
      },
      { label: 'Keep the $10', outcomes: [o('{name} bought a nice coffee instead.', { happiness: 1 })] },
    ],
  },

  // ---- Senior -------------------------------------------------------------
  {
    id: 'retirement',
    stages: ['senior'],
    minAge: 60,
    weight: 3,
    cooldown: 3,
    when: (ctx) => ctx.char.job,
    text: '{name} could retire from being a {job}.',
    choices: [
      { label: 'Retire', outcomes: [o('{name} retired with cake and a card from the whole {workplace}.', { happiness: 10, set: ['retired'] }, { do: (c) => c.loseJob() })] },
      { label: 'Keep working a few more years', outcomes: [o('{name} likes feeling useful.', { happiness: 2, health: -2 })] },
    ],
  },
  {
    id: 'grandkids',
    stages: ['senior'],
    cooldown: 3,
    when: (ctx) => ctx.char.children.some((k) => k.age > 25),
    text: 'The grandkids are coming over for the weekend.',
    choices: [
      { label: 'Bake cookies together', outcomes: [o('Flour everywhere, smiles everywhere.', { happiness: 8 })] },
      { label: 'Tell stories about the old days', outcomes: [o('{name} told the story of the city when it was only a few houses.', { happiness: 6, smarts: 1 })] },
    ],
  },
  {
    id: 'checkup',
    stages: ['adult', 'senior'],
    minAge: 50,
    cooldown: 3,
    text: 'It\'s time for {name}\'s yearly check-up.',
    choices: [
      {
        label: 'Go to the clinic',
        outcomes: [
          o('The clinic nearby caught a problem early.', { health: 8 }, { weight: (c) => (c.facts.clinicCoverage > 0.25 ? 4 : 0) }),
          o('The nearest clinic is far away. {name} went anyway; all clear.', { health: 2, happiness: -2 }, { weight: (c) => (c.facts.clinicCoverage > 0.25 ? 0 : 1) }),
        ],
      },
      { label: 'Skip it', outcomes: [o('{name} feels fine, probably.', { health: -4 })] },
    ],
  },
  {
    id: 'garden_club',
    stages: ['senior'],
    once: true,
    text: 'The neighbourhood garden club is looking for members.',
    choices: [
      { label: 'Join', outcomes: [o('{name} grew prize-winning tomatoes.', { happiness: 7, health: 3 }, { do: (c) => c.addFriend(55) })] },
      { label: 'Not for {name}', outcomes: [o('{name} prefers a quiet garden of one.', { happiness: 1 })] },
    ],
  },
  {
    id: 'memoir',
    stages: ['senior'],
    once: true,
    text: '{name} is thinking about writing a memoir.',
    choices: [
      { label: 'Write it', outcomes: [o('"Growing Up in Pocket Metropolis" was a local bestseller.', { happiness: 8, smarts: 3, money: 800 }, { weight: (c) => 1 + c.char.stats.smarts / 50 }), o('{name} wrote it for the family. They loved it.', { happiness: 6 })] },
      { label: 'Some stories are best left untold', outcomes: [o('{name} smiled and kept the secrets.', { happiness: 2 })] },
    ],
  },
  {
    id: 'quiet_day',
    stages: ['child', 'teen', 'young', 'adult', 'senior'],
    weight: 0.4,
    cooldown: 3,
    text: 'A quiet, sunny day in the city.',
    choices: [
      { label: 'Walk around the neighbourhood', outcomes: [o('{name} said hello to every neighbour.', { happiness: 3, health: 1 })] },
      { label: 'Call {friend}', outcomes: [o('A long, happy phone call with {friend}.', { happiness: 2, rel: { friend: 4 } })] },
      { label: 'Do nothing at all', outcomes: [o('Perfect.', { happiness: 2 })] },
    ],
  },
];

// City-linked events, buying a home, siblings and more live in lifeEventsMore.js.
LIFE_EVENTS.push(...MORE_EVENTS, ...LEGACY_EVENTS);
