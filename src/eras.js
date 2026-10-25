// Eras and the town calendar. A town is founded in 1850 and a year passes each in-game day, the same
// pace as a Life Story life, so a family's grandparents see dirt lanes and horse carts while their
// grandchildren grow up with buses, asphalt and electric light.
//
// An era needs both people and time: enough residents, and enough years since the town was founded.
// Town decisions can bring an era closer (`state.bonusYears`). Eras never go backwards.
//
// Saved in city.systems.era = { index, startYear, bonusYears, history: [{ index, year }] }.

export const FOUNDING_YEAR = 1850;

export const ERAS = [
  {
    id: 'pioneer',
    label: 'Pioneer days',
    pop: 0,
    years: 0,
    nominal: 1850,
    blurb: 'Dirt lanes, timber cottages and horse carts.',
    builds: ['cottage', 'house', 'shop', 'cafe', 'bakery', 'school', 'clinic', 'park', 'playground', 'bungalow', 'market', 'pharmacy', 'firehut', 'garden', 'farm'],
  },
  {
    id: 'railway',
    label: 'Railway age',
    pop: 60,
    years: 15,
    nominal: 1865,
    blurb: 'Cobbled streets, brick houses and gas lamps. The first motor cars rattle by.',
    builds: ['apartments', 'factory', 'library', 'firestation', 'rowhouse', 'restaurant', 'kindergarten', 'warehouse', 'workshop', 'fountain'],
  },
  {
    id: 'motor',
    label: 'Motor age',
    pop: 180,
    years: 35,
    nominal: 1885,
    blurb: 'Paved roads, electric street lights and cars for everyone.',
    builds: ['office', 'mall', 'field', 'villa', 'bank', 'hotel', 'cinema', 'museum', 'pool', 'powerplant'],
  },
  {
    id: 'modern',
    label: 'Modern times',
    pop: 400,
    years: 60,
    nominal: 1910,
    blurb: 'Towers rise downtown and the streets hum with traffic.',
    builds: ['tower', 'university', 'hospital', 'stadium'],
  },
  {
    id: 'future',
    label: 'Bright future',
    pop: 800,
    years: 90,
    nominal: 1940,
    blurb: 'Solar roofs, quiet electric cars and gardens everywhere.',
    builds: [],
  },
];

// Every building the town can grow by itself in a given era (each era keeps the ones before).
export function buildsFor(index) {
  return ERAS.slice(0, index + 1).flatMap((e) => e.builds);
}

// The highest era a town of this size could reach, ignoring the years needed (for older saves).
export function eraForPopulation(pop) {
  let i = 0;
  ERAS.forEach((e, k) => {
    if (pop >= e.pop) i = k;
  });
  return i;
}

export class Eras {
  constructor(city) {
    this.city = city;
  }

  get state() {
    const s = this.city.systems;
    if (!s.era) {
      // A town from before eras existed starts in the era its size suggests, and the calendar is set so
      // the year looks right for it. A brand-new town starts in 1850.
      const index = eraForPopulation(this.city.stats?.population || 0);
      const day = Math.max(1, this.city.day || 1);
      s.era = { index, startYear: index ? ERAS[index].nominal - day : FOUNDING_YEAR - day, bonusYears: 0, foundedDay: index ? day - ERAS[index].years : day, history: [{ index, year: 0 }] };
      s.era.history[0].year = this.year;
    }
    return s.era;
  }

  get index() {
    return this.state.index;
  }

  get current() {
    return ERAS[this.index];
  }

  get next() {
    return ERAS[this.index + 1] || null;
  }

  // The calendar year right now.
  get year() {
    const s = this.city.systems.era;
    return (s ? s.startYear : FOUNDING_YEAR - 1) + Math.max(1, this.city.day);
  }

  // Years since the town was founded, plus any head start from decisions.
  get age() {
    const st = this.state;
    return Math.max(0, this.city.day - (st.foundedDay ?? 1)) + (st.bonusYears || 0);
  }

  // Start a brand-new town's calendar today.
  found() {
    const day = Math.max(1, this.city.day);
    this.city.systems.era = { index: 0, startYear: FOUNDING_YEAR - day, bonusYears: 0, foundedDay: day, history: [{ index: 0, year: FOUNDING_YEAR }] };
  }

  // What the next era still needs: people and years.
  progress() {
    const next = this.next;
    if (!next) return null;
    const pop = this.city.stats?.population || 0;
    return {
      next,
      pop,
      needPop: next.pop,
      years: this.age,
      needYears: next.years,
      fraction: Math.min(1, pop / next.pop) * 0.5 + Math.min(1, this.age / Math.max(1, next.years)) * 0.5,
    };
  }

  // Called after stats update. Moves on one era at a time and announces it.
  update() {
    const st = this.state;
    const next = this.next;
    if (!next) return null;
    const pop = this.city.stats?.population || 0;
    if (pop < next.pop || this.age < next.years) return null;
    st.index++;
    st.history.push({ index: st.index, year: this.year });
    this.city.revision++; // roads and lamps are redrawn in the new style
    this.city.emit('era', { era: ERAS[st.index], index: st.index, year: this.year });
    return ERAS[st.index];
  }

  // A decision can bring the next era closer.
  hurry(years) {
    this.state.bonusYears = (this.state.bonusYears || 0) + years;
  }
}

// The calendar year for any city, without needing an Eras instance (for the UI and Life Story).
export function yearOf(city) {
  const s = city.systems.era;
  return (s ? s.startYear : FOUNDING_YEAR - 1) + Math.max(1, city.day);
}
