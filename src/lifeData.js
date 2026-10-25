// Life Story data: names, traits, careers, looks. Pure data, no logic.

export const FIRST_NAMES = [
  'Ava', 'Kai', 'Noor', 'Mateo', 'Zara', 'Eli', 'Mina', 'Theo', 'Amara', 'Luca', 'Ines', 'Jun', 'Priya', 'Omar',
  'Freya', 'Kofi', 'Lena', 'Ravi', 'Sofia', 'Malik', 'Hana', 'Felix', 'Yara', 'Diego', 'Ivy', 'Sami', 'Clara',
  'Tariq', 'June', 'Nico', 'Aisha', 'Leo', 'Maya', 'Emeka', 'Rosa', 'Arlo', 'Lila', 'Kenji', 'Nadia', 'Ezra',
];
export const LAST_NAMES = [
  'Park', 'Okafor', 'Rivera', 'Haddad', 'Lindqvist', 'Nakamura', 'Moreau', 'Patel', 'Costa', 'Mensah', 'Novak',
  'Ibarra', 'Kowalski', 'Ahmed', 'Bellamy', 'Fontaine', 'Osei', 'Tanaka', 'Romero', 'Quinn', 'Varga', 'Silva',
];

export const PRONOUNS = {
  she: { they: 'she', them: 'her', their: 'her', label: 'She / her' },
  he: { they: 'he', them: 'him', their: 'his', label: 'He / him' },
  they: { they: 'they', them: 'them', their: 'their', label: 'They / them' },
};

export const SKIN_TONES = ['#f6d5bd', '#f1c7a5', '#e8b896', '#c98e6a', '#a86f4c', '#8d5a3f'];
export const HAIR_COLORS = ['#2f2a33', '#5b3a29', '#a0643a', '#e2b86b', '#c9603f', '#b9b4c9'];
export const OUTFIT_COLORS = ['#ff8f7e', '#7fc4ad', '#a98bd0', '#ffcf6e', '#86b5e6', '#f49ab8'];

export const TRAITS = [
  { id: 'curious', label: 'Curious', hint: 'Learns faster' },
  { id: 'outgoing', label: 'Outgoing', hint: 'Makes friends easily' },
  { id: 'thrifty', label: 'Thrifty', hint: 'Saves more money' },
  { id: 'sporty', label: 'Sporty', hint: 'Stays healthier' },
  { id: 'creative', label: 'Creative', hint: 'Shines at art and music' },
  { id: 'calm', label: 'Calm', hint: 'Shrugs off bad days' },
];

// Jobs come from real workplaces in the city. Requirements use Smarts; pay is per year.
export const CAREERS = {
  shop: { titles: ['Shop assistant', 'Senior assistant', 'Shop manager'], pay: [18000, 24000, 34000], smarts: 0 },
  office: { titles: ['Office junior', 'Analyst', 'Team lead', 'Director'], pay: [26000, 38000, 52000, 80000], smarts: 45 },
  school: { titles: ['Teaching assistant', 'Teacher', 'Head teacher'], pay: [22000, 34000, 48000], smarts: 55 },
  clinic: { titles: ['Care assistant', 'Nurse', 'Doctor'], pay: [22000, 36000, 70000], smarts: 60 },
  cafe: { titles: ['Barista', 'Café manager'], pay: [16000, 26000], smarts: 0 },
  mall: { titles: ['Sales assistant', 'Floor manager', 'Mall director'], pay: [19000, 30000, 55000], smarts: 10 },
  factory: { titles: ['Machine operator', 'Foreman', 'Plant manager'], pay: [24000, 34000, 60000], smarts: 20 },
  bakery: { titles: ["Baker's helper", 'Baker', 'Master baker'], pay: [15000, 22000, 31000], smarts: 0 },
  library: { titles: ['Library assistant', 'Librarian', 'Head librarian'], pay: [17000, 27000, 38000], smarts: 35 },
  firestation: { titles: ['Volunteer firefighter', 'Firefighter', 'Fire chief'], pay: [20000, 32000, 50000], smarts: 10 },
  university: { titles: ['Lab technician', 'Lecturer', 'Professor', 'Dean'], pay: [24000, 40000, 62000, 90000], smarts: 70 },
  restaurant: { titles: ['Kitchen hand', 'Cook', 'Head chef'], pay: [16000, 25000, 40000], smarts: 5 },
  market: { titles: ['Stall helper', 'Stallholder', 'Market master'], pay: [14000, 21000, 30000], smarts: 0 },
  bank: { titles: ['Bank clerk', 'Loans officer', 'Branch manager'], pay: [25000, 40000, 70000], smarts: 50 },
  hotel: { titles: ['Porter', 'Receptionist', 'Hotel manager'], pay: [16000, 24000, 45000], smarts: 10 },
  warehouse: { titles: ['Loader', 'Forklift driver', 'Warehouse manager'], pay: [19000, 28000, 46000], smarts: 5 },
  workshop: { titles: ['Apprentice', 'Craftsperson', 'Master craftsperson'], pay: [16000, 28000, 44000], smarts: 15 },
  powerplant: { titles: ['Stoker', 'Engineer', 'Chief engineer'], pay: [26000, 42000, 68000], smarts: 40 },
  kindergarten: { titles: ['Helper', 'Kindergarten teacher', 'Head of kindergarten'], pay: [15000, 24000, 36000], smarts: 30 },
  museum: { titles: ['Attendant', 'Guide', 'Curator'], pay: [17000, 28000, 46000], smarts: 45 },
  pharmacy: { titles: ['Counter assistant', 'Pharmacist', 'Head pharmacist'], pay: [18000, 38000, 56000], smarts: 55 },
  hospital: { titles: ['Orderly', 'Nurse', 'Surgeon', 'Chief of medicine'], pay: [22000, 38000, 85000, 120000], smarts: 65 },
  firehut: { titles: ['Volunteer', 'Firefighter'], pay: [18000, 28000], smarts: 5 },
  garden: { titles: ['Gardener', 'Head gardener'], pay: [15000, 24000], smarts: 0 },
  pool: { titles: ['Lifeguard', 'Swimming coach', 'Pool manager'], pay: [16000, 26000, 38000], smarts: 10 },
  cinema: { titles: ['Ticket seller', 'Projectionist', 'Cinema manager'], pay: [15000, 24000, 40000], smarts: 10 },
  farm: { titles: ['Farmhand', 'Farmer', 'Master farmer'], pay: [15000, 24000, 38000], smarts: 0 },
  stadium: { titles: ['Groundskeeper', 'Steward', 'Stadium manager'], pay: [17000, 25000, 48000], smarts: 10 },
};

export const STAGES = [
  { id: 'baby', label: 'Baby', from: 0 },
  { id: 'child', label: 'Child', from: 3 },
  { id: 'teen', label: 'Teen', from: 13 },
  { id: 'young', label: 'Young adult', from: 18 },
  { id: 'adult', label: 'Adult', from: 30 },
  { id: 'senior', label: 'Senior', from: 60 },
];

export function stageFor(age) {
  let s = STAGES[0];
  for (const st of STAGES) if (age >= st.from) s = st;
  return s;
}
