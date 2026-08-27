export type CalendarGroup = 'mine' | 'other';

export interface CalendarDef {
	id: string;
	name: string;
	label: string;
	color: string;
	on: boolean;
	group: CalendarGroup;
}

export interface Guest {
	init: string;
	name: string;
	email: string;
	bg: string;
	fg: string;
}

export interface Person extends Guest {}

export interface CalEvent {
	id: string;
	cal: string;
	title: string;
	day: string;
	start: string | null;
	end: string | null;
	allDay: boolean;
	endDay?: string;
	loc?: string;
	video?: string | null;
	desc?: string;
	guests?: Guest[];
	organizer?: string;
}

export const MONTH_NAMES = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
];
export const MONTH_ABBR = [
	'Jan',
	'Feb',
	'Mar',
	'Apr',
	'May',
	'Jun',
	'Jul',
	'Aug',
	'Sep',
	'Oct',
	'Nov',
	'Dec'
];

export const CAL_TODAY = new Date(2026, 5, 15, 10, 24);

export const CALENDARS: CalendarDef[] = [
	{ id: 'personal', name: 'François Rabelais', label: 'My calendar', color: '#2E5440', on: true, group: 'mine' },
	{ id: 'family', name: 'Family', label: 'Family', color: '#A87C3D', on: true, group: 'mine' },
	{ id: 'thelema', name: 'Thélème Co', label: 'Work', color: '#3C6E8C', on: true, group: 'mine' },
	{ id: 'infra', name: 'Domains & infra', label: 'Infra', color: '#9B5B4E', on: true, group: 'mine' },
	{ id: 'birthdays', name: 'Birthdays', label: 'Birthdays', color: '#7E6BA8', on: true, group: 'mine' },
	{ id: 'holidays', name: 'Holidays in France', label: 'Holidays', color: '#5E8C70', on: true, group: 'other' },
	{ id: 'moon', name: 'Phases of the moon', label: 'Moon', color: '#6B7360', on: false, group: 'other' }
];

export const CAL_BY_ID: Record<string, CalendarDef> = Object.fromEntries(
	CALENDARS.map((c) => [c.id, c])
);

export const PPL: Record<string, Person> = {
	you: { init: 'FR', name: 'François Rabelais', email: 'you@meudon.fr', bg: '#234132', fg: '#EEF2EA' },
	marie: { init: 'MT', name: 'Marie Thélème', email: 'marie@meudon.fr', bg: 'var(--pine-100)', fg: 'var(--pine-700)' },
	alex: { init: 'AM', name: 'Alex Meudon', email: 'alex@meudon.fr', bg: 'var(--brass-100)', fg: 'var(--brass-700)' },
	jules: { init: 'J', name: 'Jules', email: 'jules@meudon.fr', bg: 'var(--info-100)', fg: 'var(--info-700)' },
	colette: { init: 'C', name: 'Colette', email: 'colette@meudon.fr', bg: '#EAE0F0', fg: '#6A4E86' },
	team: { init: 'TC', name: 'Thélème Co', email: 'team@thelema.co', bg: 'var(--info-100)', fg: 'var(--info-700)' }
};

const guests = (...keys: string[]): Guest[] => keys.map((k) => PPL[k]);

const pad2 = (n: number) => String(n).padStart(2, '0');
export const ymd = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const minutesOf = (hhmm: string) => {
	const [h, m] = hhmm.split(':').map(Number);
	return h * 60 + m;
};
export const addDays = (d: Date, n: number) => {
	const x = new Date(d);
	x.setDate(x.getDate() + n);
	return x;
};
export const startOfWeek = (d: Date, weekStartsMon = true) => {
	const x = new Date(d);
	x.setHours(0, 0, 0, 0);
	const dow = x.getDay();
	const diff = weekStartsMon ? (dow + 6) % 7 : dow;
	return addDays(x, -diff);
};
export const sameDay = (a: Date, b: Date) => ymd(a) === ymd(b);
export const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);

const D = (n: number) => ymd(addDays(CAL_TODAY, n));

let eid = 0;
const ev = (
	cal: string,
	title: string,
	day: string,
	start: string,
	end: string,
	extra: Partial<CalEvent> = {}
): CalEvent => ({ id: 'e' + ++eid, cal, title, day, start, end, allDay: false, ...extra });
const allDayEv = (cal: string, title: string, day: string, extra: Partial<CalEvent> = {}): CalEvent => ({
	id: 'e' + ++eid,
	cal,
	title,
	day,
	start: null,
	end: null,
	allDay: true,
	endDay: extra.endDay || day,
	...extra
});

const MON = 0,
	TUE = 1,
	WED = 2,
	THU = 3,
	FRI = 4,
	SAT = 5,
	SUN = 6;

export const EVENTS: CalEvent[] = [
	ev('family', 'School run — Jules & Colette', D(MON), '08:00', '08:30', { loc: 'Meudon' }),
	ev('thelema', 'Daily standup', D(MON), '09:30', '09:45', { video: 'meet.thelema.co/standup', guests: guests('you', 'alex', 'marie', 'team') }),
	ev('thelema', '1:1 with Marie', D(MON), '11:00', '12:00', { video: 'meet.thelema.co/marie', guests: guests('you', 'marie') }),
	ev('personal', 'Lunch with Alex', D(MON), '13:00', '13:45', { loc: 'Café de Meudon' }),
	ev('family', 'Colette — riding lesson', D(MON), '16:30', '17:30', { loc: 'Écuries de Thélème' }),
	ev('thelema', 'Daily standup', D(TUE), '09:30', '09:45', { video: 'meet.thelema.co/standup', guests: guests('you', 'alex', 'marie', 'team') }),
	ev('thelema', 'Roadmap review', D(TUE), '10:30', '11:30', { video: 'meet.thelema.co/roadmap', guests: guests('you', 'alex', 'marie') }),
	ev('infra', 'Certificate renewal — meudon.fr', D(TUE), '15:00', '15:30', { loc: 'Automated', desc: 'TLS cert auto-renews via ACME. Window reserved in case manual DNS is needed.' }),
	ev('personal', 'Dentist', D(TUE), '19:00', '20:00', { loc: 'Dr. Pichon · Meudon' }),
	ev('thelema', 'Daily standup', D(WED), '09:30', '09:45', { video: 'meet.thelema.co/standup', guests: guests('you', 'alex', 'marie', 'team') }),
	allDayEv('family', 'Jules — last day of school', D(WED), { loc: 'Collège de Meudon' }),
	ev('family', 'Lunch with Marie', D(WED), '12:30', '13:30', { loc: 'Home' }),
	ev('thelema', 'Design critique', D(WED), '15:00', '16:00', { video: 'meet.thelema.co/crit', guests: guests('you', 'alex') }),
	ev('thelema', 'Daily standup', D(THU), '09:30', '09:45', { video: 'meet.thelema.co/standup', guests: guests('you', 'alex', 'marie', 'team') }),
	ev('thelema', 'Quarterly access review', D(THU), '15:00', '16:00', { video: 'meet.thelema.co/access', organizer: 'alex', guests: guests('alex', 'you', 'marie', 'team'), desc: 'Walk through every mailbox, alias, and admin grant from the last 90 days.' }),
	ev('personal', 'Gym', D(THU), '17:30', '18:30', { loc: 'Salle Rabelais' }),
	ev('thelema', 'Daily standup', D(FRI), '09:30', '09:45', { video: 'meet.thelema.co/standup', guests: guests('you', 'alex', 'marie', 'team') }),
	ev('infra', 'DNS migration window — meudon.fr', D(FRI), '10:00', '11:30', { loc: 'Maintenance', desc: 'Cutover of MX and DKIM selectors. Mail keeps flowing; brief propagation delay expected.' }),
	ev('thelema', 'Board sync', D(FRI), '14:00', '15:00', { video: 'meet.thelema.co/board', guests: guests('you', 'marie', 'alex') }),
	allDayEv('personal', 'Working from Meudon', D(FRI)),
	allDayEv('family', 'Family weekend', D(SAT), { endDay: D(SUN) }),
	ev('family', 'Market & errands', D(SAT), '10:00', '12:00', { loc: 'Place de Meudon' }),
	ev('family', 'Sunday lunch', D(SUN), '12:30', '14:30', { loc: 'Home', guests: guests('you', 'marie', 'jules', 'colette', 'alex') }),
	allDayEv('birthdays', 'Marie’s birthday', D(SUN)),

	ev('thelema', 'Daily standup', D(MON - 7), '09:30', '09:45'),
	ev('thelema', 'Daily standup', D(TUE - 7), '09:30', '09:45'),
	ev('thelema', 'Daily standup', D(WED - 7), '09:30', '09:45'),
	ev('thelema', 'Daily standup', D(THU - 7), '09:30', '09:45'),
	ev('thelema', 'Daily standup', D(FRI - 7), '09:30', '09:45'),
	ev('family', 'Colette — riding lesson', D(MON - 7), '16:30', '17:30'),
	ev('thelema', 'Sprint planning', D(MON - 7), '10:30', '12:00', { video: 'meet.thelema.co/sprint' }),
	ev('personal', 'Haircut', D(WED - 7), '18:00', '18:45', { loc: 'Meudon' }),
	ev('infra', 'Backup verification', D(FRI - 7), '14:00', '14:30'),
	allDayEv('holidays', 'Pentecôte', D(SUN - 7)),

	ev('thelema', 'Daily standup', D(MON + 7), '09:30', '09:45'),
	ev('thelema', 'Daily standup', D(TUE + 7), '09:30', '09:45'),
	ev('thelema', 'Daily standup', D(WED + 7), '09:30', '09:45'),
	ev('thelema', 'Daily standup', D(THU + 7), '09:30', '09:45'),
	ev('thelema', 'Daily standup', D(FRI + 7), '09:30', '09:45'),
	ev('family', 'Colette — riding lesson', D(MON + 7), '16:30', '17:30'),
	ev('thelema', '1:1 with Marie', D(MON + 7), '11:00', '12:00'),
	ev('thelema', 'Quarterly access review — follow-up', D(THU + 7), '15:00', '15:45', { video: 'meet.thelema.co/access' }),
	ev('personal', 'Lunch with Alex', D(WED + 7), '13:00', '14:00', { loc: 'Café de Meudon' }),
	allDayEv('personal', 'Annual leave', D(FRI + 7), { endDay: D(SUN + 7) }),
	ev('infra', 'Quarterly key rotation', D(TUE + 7), '16:00', '16:30'),

	allDayEv('holidays', 'Fête de la Musique', '2026-06-21'),
	allDayEv('birthdays', 'Jules’ birthday', '2026-06-28'),
	ev('thelema', 'All-hands', '2026-06-30', '16:00', '17:00', { video: 'meet.thelema.co/all' }),
	ev('infra', 'Monthly uptime report', '2026-06-30', '09:00', '09:30'),
	ev('family', 'Parents’ evening', '2026-06-25', '18:00', '19:30', { loc: 'Collège de Meudon' }),
	ev('personal', 'Dentist — follow-up', '2026-06-26', '19:00', '19:45')
];
