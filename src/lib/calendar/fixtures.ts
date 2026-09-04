import type {
	AgendaDayFixture,
	AllDayItem,
	BookingDayFixture,
	CalendarDef,
	CalendarId,
	Item,
	Person,
	PersonId,
	SlotFixture,
	TaskFixture
} from './types';

export const CALENDARS: Record<CalendarId, CalendarDef> = {
	personal: { name: 'My calendar', color: '#2E5440', group: 'mine' },
	family: { name: 'Family', color: '#A87C3D', group: 'mine' },
	thelema: { name: 'Thélème Co', color: '#3C6E8C', group: 'mine' },
	infra: { name: 'Domains & infra', color: '#9B5B4E', group: 'mine' },
	school: { name: 'school@meudon.fr', color: '#6E5B9E', group: 'role', badge: '4' },
	bookings: { name: 'bookings@thelema.co', color: '#4E8073', group: 'role', badge: '2' },
	holidays: { name: 'Holidays in France', color: '#6B7360', group: 'other', readOnly: true },
	gcal: { name: 'Alex — Google, busy only', color: '#7E6BA8', group: 'other', readOnly: true }
};

export const PEOPLE: Record<PersonId, Person> = {
	you: {
		init: 'FR',
		name: 'François',
		full: 'François Rabelais',
		email: 'you@meudon.fr',
		bg: '#234132',
		fg: '#EEF2EA'
	},
	marie: {
		init: 'MT',
		name: 'Marie',
		full: 'Marie Thélème',
		email: 'marie@meudon.fr',
		bg: 'var(--pine-100)',
		fg: 'var(--pine-700)'
	},
	alex: {
		init: 'AM',
		name: 'Alex',
		full: 'Alex Meudon',
		email: 'alex@meudon.fr',
		bg: 'var(--brass-100)',
		fg: 'var(--brass-700)'
	},
	jules: {
		init: 'J',
		name: 'Jules',
		full: 'Jules',
		email: 'jules@meudon.fr',
		bg: 'var(--info-100)',
		fg: 'var(--info-700)'
	},
	colette: {
		init: 'C',
		name: 'Colette',
		full: 'Colette',
		email: 'colette@meudon.fr',
		bg: '#EAE0F0',
		fg: '#6A4E86'
	},
	panurge: {
		init: 'RP',
		name: 'R. Panurge',
		full: 'R. Panurge',
		email: 'panurge@quart-livre.example',
		bg: 'var(--paper-150)',
		fg: 'var(--ink-600)',
		external: true
	}
};

export const DOW = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
export const DAY_NUMS = [15, 16, 17, 18, 19, 20, 21];
export const MONTH_LABEL = 'June';
export const YEAR_LABEL = '2026';
export const ZONE = 'CEST';
export const NOW_MINUTES = 10 * 60 + 24;

export const ITEMS: Item[] = [
	{ id: 'a1', kind: 'event', cal: 'family', title: 'School run — Jules & Colette', day: 0, start: '08:00', end: '08:30', loc: 'Collège de Meudon' },
	{ id: 'a2', kind: 'event', cal: 'thelema', title: 'Daily standup', day: 0, start: '09:30', end: '09:45', video: true, guests: ['you', 'alex', 'marie'] },
	{ id: 'a3', kind: 'event', cal: 'thelema', title: '1:1 with Marie', day: 0, start: '11:00', end: '12:00', video: true, guests: ['you', 'marie'] },
	{ id: 'a4', kind: 'event', cal: 'personal', title: 'Lunch with Alex', day: 0, start: '13:00', end: '13:45', loc: 'Café de Meudon' },
	{ id: 'a5', kind: 'task', cal: 'thelema', title: 'Draft Q3 deliverability note', day: 0, start: '14:30', end: '15:30', due: 'Wed 17 Jun', est: '1h', owner: 'you' },
	{ id: 'a6', kind: 'event', cal: 'family', title: 'Colette — riding lesson', day: 0, start: '16:30', end: '17:30', loc: 'Écuries de Thélème' },

	{ id: 'b1', kind: 'event', cal: 'thelema', title: 'Daily standup', day: 1, start: '09:30', end: '09:45', video: true, guests: ['you', 'alex', 'marie'] },
	{ id: 'b2', kind: 'event', cal: 'thelema', title: 'Roadmap review', day: 1, start: '10:30', end: '11:30', video: true, guests: ['you', 'alex', 'marie'] },
	{ id: 'b3', kind: 'hold', cal: 'personal', title: 'Busy', day: 1, start: '13:00', end: '14:00' },
	{ id: 'b4', kind: 'event', cal: 'infra', title: 'Certificate renewal — meudon.fr', day: 1, start: '15:00', end: '15:30', loc: 'Automated' },
	{ id: 'b5', kind: 'event', cal: 'personal', title: 'Dentist', day: 1, start: '19:00', end: '20:00', loc: 'Dr. Pichon · Meudon' },

	{ id: 'c1', kind: 'event', cal: 'thelema', title: 'Daily standup', day: 2, start: '09:30', end: '09:45', video: true, guests: ['you', 'alex', 'marie'] },
	{ id: 'c2', kind: 'prop', cal: 'bookings', title: 'Studio walkthrough', day: 2, start: '11:00', end: '12:00', guests: ['you', 'panurge'] },
	{ id: 'c3', kind: 'event', cal: 'family', title: 'Lunch with Marie', day: 2, start: '12:30', end: '13:30', loc: 'Home', guests: ['you', 'marie'] },
	{ id: 'c4', kind: 'event', cal: 'thelema', title: 'Design critique', day: 2, start: '15:00', end: '16:00', video: true, guests: ['you', 'alex'] },
	{ id: 'c5', kind: 'task', cal: 'school', title: 'Return signed consent form', day: 2, start: '17:00', end: '17:20', due: 'Wed 17 Jun, 18:00', est: '10m', owner: 'marie', fromMail: true, thread: 'Sortie scolaire — Musée de Cluny' },

	{ id: 'd1', kind: 'event', cal: 'thelema', title: 'Daily standup', day: 3, start: '09:30', end: '09:45', video: true, guests: ['you', 'alex', 'marie'] },
	{ id: 'd2', kind: 'task', cal: 'infra', title: 'Rotate DKIM selector', day: 3, start: '11:00', end: '12:00', due: 'Fri 19 Jun', est: '1h', owner: 'you' },
	{ id: 'd3', kind: 'event', cal: 'thelema', title: 'Quarterly access review', day: 3, start: '15:00', end: '16:00', video: true, organizer: 'alex', rsvp: true, guests: ['alex', 'you', 'marie'] },
	{ id: 'd4', kind: 'event', cal: 'family', title: 'Pick up Colette', day: 3, start: '15:30', end: '16:00', loc: 'Écuries de Thélème' },
	{ id: 'd5', kind: 'event', cal: 'personal', title: 'Gym', day: 3, start: '17:30', end: '18:30', loc: 'Salle Rabelais' },

	{ id: 'e1', kind: 'event', cal: 'thelema', title: 'Daily standup', day: 4, start: '09:30', end: '09:45', video: true, guests: ['you', 'alex', 'marie'] },
	{ id: 'e2', kind: 'event', cal: 'infra', title: 'DNS migration window — meudon.fr', day: 4, start: '10:00', end: '11:30', loc: 'Maintenance' },
	{ id: 'e3', kind: 'event', cal: 'thelema', title: 'Board sync', day: 4, start: '14:00', end: '15:00', video: true, guests: ['you', 'marie', 'alex'] },
	{ id: 'e4', kind: 'event', cal: 'bookings', title: 'Consultation — R. Panurge', day: 4, start: '16:00', end: '16:30', loc: 'Studio · 12 rue de Thélème', external: true, buffer: 15, guests: ['you', 'panurge'] },

	{ id: 'f1', kind: 'event', cal: 'family', title: 'Market & errands', day: 5, start: '10:00', end: '12:00', loc: 'Place de Meudon' },
	{ id: 'g1', kind: 'event', cal: 'family', title: 'Sunday lunch', day: 6, start: '12:30', end: '14:30', loc: 'Home', guests: ['you', 'marie', 'jules', 'colette', 'alex'] }
];

export const ALL_DAY: AllDayItem[] = [
	{ id: 'ad1', cal: 'family', title: 'Jules — last day of school', day: 2, span: 1 },
	{ id: 'ad2', cal: 'personal', title: 'Working from Meudon', day: 4, span: 1 },
	{ id: 'ad3', cal: 'family', title: 'Family weekend', day: 5, span: 2, solid: true },
	{ id: 'ad4', cal: 'school', title: 'Museum trip — Jules', day: 3, span: 1, fromMail: true }
];

export const MONTH_EXTRA: Record<number, [CalendarId, string, string | null][]> = {
	8: [['thelema', 'Sprint planning', '10:30']],
	9: [['personal', 'Haircut', '18:00']],
	11: [['infra', 'Backup verification', '14:00']],
	14: [['holidays', 'Pentecôte', null]],
	22: [
		['thelema', '1:1 with Marie', '11:00'],
		['family', 'Colette — riding', '16:30']
	],
	23: [['infra', 'Quarterly key rotation', '16:00']],
	24: [['personal', 'Lunch with Alex', '13:00']],
	25: [
		['school', 'Museum trip — Jules', null],
		['family', 'Parents’ evening', '18:00']
	],
	26: [
		['personal', 'Dentist — follow-up', '19:00'],
		['personal', 'Annual leave', null]
	],
	28: [['holidays', 'Fête de la Musique', null]],
	30: [
		['infra', 'Monthly uptime report', '09:00'],
		['thelema', 'All-hands', '16:00']
	]
};

export const TASK_GROUPS = ['Rolled over', 'Scheduled this week', 'Not scheduled yet'];

export const TASKS: TaskFixture[] = [
	{ group: 'Rolled over', id: 't0', cal: 'infra', title: 'Answer Fastmail migration question', due: 'Was Fri 12 Jun', est: '20m', owner: 'François', late: true, roll: '2nd rollover' },
	{ group: 'Scheduled this week', id: 'a5', cal: 'thelema', title: 'Draft Q3 deliverability note', due: 'Wed 17 Jun', est: '1h', owner: 'François', boxed: true },
	{ group: 'Scheduled this week', id: 'd2', cal: 'infra', title: 'Rotate DKIM selector', due: 'Fri 19 Jun', est: '1h', owner: 'François', boxed: true },
	{ group: 'Scheduled this week', id: 'c5', cal: 'school', title: 'Return signed consent form', due: 'Wed 17 Jun, 18:00', est: '10m', owner: 'Marie', boxed: true, fromMail: true },
	{ group: 'Not scheduled yet', id: 't3', cal: 'family', title: 'Pay museum trip fee — €18', due: 'Mon 22 Jun', est: '5m', owner: 'Unassigned' },
	{ group: 'Not scheduled yet', id: 't4', cal: 'thelema', title: 'Review round-robin rules for bookings@', due: 'Thu 25 Jun', est: '45m', owner: 'François' },
	{ group: 'Not scheduled yet', id: 't5', cal: 'personal', title: 'Book Colette’s summer course', due: 'No date', est: '15m', owner: 'Marie' }
];

export const AGENDA: AgendaDayFixture[] = [
	{
		day: 0,
		rows: [
			{ cal: 'family', time: '08:00', title: 'School run — Jules & Colette', sub: 'Recurring · weekdays', owner: 'marie', ack: ['you'] },
			{ cal: 'thelema', time: '15:00', title: 'Quarterly access review', sub: 'Organised by Alex · 3 members', owner: 'alex', ack: ['you', 'marie'] }
		]
	},
	{
		day: 2,
		rows: [
			{ cal: 'school', time: '18:00', title: 'Return signed consent form', sub: 'Task · from mail · deadline today', owner: 'marie', ack: ['you'] },
			{ cal: 'family', time: 'All day', title: 'Jules — last day of school', sub: 'No pickup needed', owner: null, ack: [] }
		]
	},
	{
		day: 3,
		rows: [
			{ cal: 'school', time: 'All day', title: 'Museum trip — Jules', sub: 'Departs 08:30 · returns 17:00 · trip PDF attached', owner: 'marie', ack: ['you'] },
			{ cal: 'family', time: '15:30', title: 'Pick up Colette', sub: 'Clashes with access review at 15:00', owner: null, ack: [] }
		]
	},
	{
		day: 4,
		rows: [
			{ cal: 'infra', time: '10:00', title: 'DNS migration window — meudon.fr', sub: 'Mail keeps flowing · brief propagation delay', owner: 'you', ack: ['marie', 'alex'] },
			{ cal: 'bookings', time: '16:00', title: 'Consultation — R. Panurge', sub: 'Booked through bookings@thelema.co · external', owner: 'you', ack: ['alex'] }
		]
	}
];

export const COUNT_WORDS = ['No', 'One', 'Two', 'Three', 'Four'];

export const SLOTS: SlotFixture[] = [
	{ when: 'Wed 17 June, 11:00 – 12:00', mono: 'CEST · 60 min · after 15 min buffer', tag: 'Good gap' },
	{ when: 'Thu 18 June, 09:00 – 10:00', mono: 'CEST · 60 min · before standup', tag: 'Good gap' },
	{ when: 'Fri 19 June, 13:30 – 14:30', mono: 'CEST · 60 min · 90 min after DNS window', tag: 'Tight', tight: true },
	{ when: 'Mon 22 June, 10:00 – 11:00', mono: 'CEST · 60 min · first slot next week', tag: 'Good gap' }
];

export const ANSWERS: Record<'panurge' | 'alex', boolean[]> = {
	panurge: [true, false, true, true],
	alex: [true, true, false, false]
};

export const BOOKING_DAYS: BookingDayFixture[] = [
	{ dow: 'WED', num: 17, free: 0, slots: [], note: 'Today is inside the twelve-hour notice window.' },
	{ dow: 'THU', num: 18, free: 4, slots: ['09:00', '09:45', '10:30', '13:30'], note: 'Four windows left after buffers.' },
	{ dow: 'FRI', num: 19, free: 3, slots: ['09:00', '13:30', '14:15'], note: 'Afternoon only — the morning is held for maintenance.' },
	{ dow: 'MON', num: 22, free: 6, slots: ['09:00', '09:45', '11:00', '13:30', '14:15', '15:00'], note: 'A full week ahead.' },
	{ dow: 'TUE', num: 23, free: 5, slots: ['09:45', '10:30', '11:15', '14:15', '16:00'], note: 'Five windows left.' }
];

export const ACCOUNT = {
	initials: 'FR',
	name: 'Frère Jean',
	email: 'frere.jean@abbaye.example'
};
