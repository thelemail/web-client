export type PreviewCalendarId =
	| 'personal'
	| 'family'
	| 'thelema'
	| 'infra'
	| 'school'
	| 'bookings'
	| 'holidays'
	| 'gcal';

export type PreviewPersonId = 'you' | 'marie' | 'alex' | 'jules' | 'colette' | 'panurge';

export interface PreviewPerson {
	init: string;
	name: string;
	full: string;
	email: string;
	bg: string;
	fg: string;
	external?: boolean;
}

export interface SlotFixture {
	when: string;
	mono: string;
	tag: string;
	tight?: boolean;
}

export interface BookingDayFixture {
	dow: string;
	num: number;
	free: number;
	slots: string[];
	note: string;
}

export const CALENDARS: Record<PreviewCalendarId, { name: string; color: string }> = {
	personal: { name: 'My calendar', color: '#2E5440' },
	family: { name: 'Family', color: '#A87C3D' },
	thelema: { name: 'Thélème Co', color: '#3C6E8C' },
	infra: { name: 'Domains & infra', color: '#9B5B4E' },
	school: { name: 'school@meudon.fr', color: '#6E5B9E' },
	bookings: { name: 'bookings@thelema.co', color: '#4E8073' },
	holidays: { name: 'Holidays in France', color: '#6B7360' },
	gcal: { name: 'Alex — Google, busy only', color: '#7E6BA8' }
};

export const PEOPLE: Record<PreviewPersonId, PreviewPerson> = {
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

export const COUNT_WORDS = ['No', 'One', 'Two', 'Three', 'Four'];

export const SLOTS: SlotFixture[] = [
	{
		when: 'Wed 17 June, 11:00 – 12:00',
		mono: 'CEST · 60 min · after 15 min buffer',
		tag: 'Good gap'
	},
	{
		when: 'Thu 18 June, 09:00 – 10:00',
		mono: 'CEST · 60 min · before standup',
		tag: 'Good gap'
	},
	{
		when: 'Fri 19 June, 13:30 – 14:30',
		mono: 'CEST · 60 min · 90 min after DNS window',
		tag: 'Tight',
		tight: true
	},
	{
		when: 'Mon 22 June, 10:00 – 11:00',
		mono: 'CEST · 60 min · first slot next week',
		tag: 'Good gap'
	}
];

export const ANSWERS: Record<'panurge' | 'alex', boolean[]> = {
	panurge: [true, false, true, true],
	alex: [true, true, false, false]
};

export const BOOKING_DAYS: BookingDayFixture[] = [
	{
		dow: 'WED',
		num: 17,
		free: 0,
		slots: [],
		note: 'Today is inside the twelve-hour notice window.'
	},
	{
		dow: 'THU',
		num: 18,
		free: 4,
		slots: ['09:00', '09:45', '10:30', '13:30'],
		note: 'Four windows left after buffers.'
	},
	{
		dow: 'FRI',
		num: 19,
		free: 3,
		slots: ['09:00', '13:30', '14:15'],
		note: 'Afternoon only — the morning is held for maintenance.'
	},
	{
		dow: 'MON',
		num: 22,
		free: 6,
		slots: ['09:00', '09:45', '11:00', '13:30', '14:15', '15:00'],
		note: 'A full week ahead.'
	},
	{
		dow: 'TUE',
		num: 23,
		free: 5,
		slots: ['09:45', '10:30', '11:15', '14:15', '16:00'],
		note: 'Five windows left.'
	}
];
