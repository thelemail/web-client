import {
	CAL_TODAY,
	CALENDARS,
	EVENTS,
	MONTH_ABBR,
	MONTH_NAMES,
	addDays,
	startOfWeek,
	ymd,
	type CalEvent
} from './data';

export type View = 'day' | '4day' | 'week' | 'month' | 'year' | 'schedule';
export type DraftKind = 'event' | 'task' | 'focus';

export interface Rect {
	left: number;
	right: number;
	top: number;
	bottom: number;
	width: number;
	height: number;
}

export interface Draft {
	kind: DraftKind;
	title: string;
	day: string;
	start: string;
	end: string;
	allDay: boolean;
	cal: string;
	loc: string;
	video: string | null;
	desc: string;
	guestText: string;
	_id?: string;
	endDay?: string;
}

export type Overlay =
	| { type: 'popover'; ev: CalEvent; rect: Rect }
	| { type: 'quick'; draft: Draft; rect: Rect }
	| { type: 'dialog'; initial: Draft; isEdit: boolean }
	| null;

export const TODAY = CAL_TODAY;

export const opts: {
	hourH: number;
	h12: boolean;
	weekStartsMon: boolean;
	showWeekends: boolean;
	workShade: boolean;
	workStart: number;
	workEnd: number;
	density: 'compact' | 'comfortable' | 'spacious';
} = {
	hourH: 50,
	h12: false,
	weekStartsMon: true,
	showWeekends: true,
	workShade: true,
	workStart: 9,
	workEnd: 18,
	density: 'comfortable'
};

const hhmm = (min: number) =>
	`${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

const fallbackRect: Rect = { left: 286, right: 298, top: 96, bottom: 96, width: 12, height: 0 };
const rectOf = (el: HTMLElement | null): Rect => {
	if (!el) return fallbackRect;
	const r = el.getBoundingClientRect();
	return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
};

function draftFromSlot(day: Date, min: number | null, calId?: string): Draft {
	const s = min == null ? 9 * 60 : min;
	const e = Math.min(s + 60, 24 * 60 - 15);
	return {
		kind: 'event',
		title: '',
		day: ymd(day),
		start: hhmm(s),
		end: hhmm(e),
		allDay: false,
		cal: calId || 'personal',
		loc: '',
		video: null,
		desc: '',
		guestText: ''
	};
}

function eventToDraft(ev: CalEvent): Draft {
	return {
		kind: 'event',
		title: ev.title,
		day: ev.day,
		start: ev.start || '09:00',
		end: ev.end || '10:00',
		allDay: !!ev.allDay,
		cal: ev.cal,
		loc: ev.loc || '',
		video: ev.video || null,
		desc: ev.desc || '',
		guestText: (ev.guests || []).map((g) => g.name).join(', '),
		_id: ev.id,
		endDay: ev.endDay
	};
}

function draftToEvent(d: Draft, existingId?: string): CalEvent {
	const guests = (d.guestText || '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean)
		.map((g) => ({
			init: (g.replace(/@.*/, '').trim().slice(0, 2) || '?').toUpperCase(),
			name: g.replace(/@.*/, '').trim() || g,
			email: g.includes('@') ? g : g.toLowerCase().replace(/[^a-z]+/g, '.') + '@meudon.fr',
			bg: 'var(--pine-100)',
			fg: 'var(--pine-700)'
		}));
	return {
		id: existingId || 'u' + Math.random().toString(36).slice(2, 8),
		cal: d.cal,
		title: d.title.trim() || '(no title)',
		day: d.day,
		start: d.allDay ? null : d.start,
		end: d.allDay ? null : d.end,
		allDay: !!d.allDay,
		loc: d.loc || undefined,
		video: d.video || undefined,
		desc: d.desc || undefined,
		endDay: d.endDay,
		guests: guests.length ? guests : undefined
	};
}

class CalendarState {
	view = $state<View>('week');
	cursor = $state<Date>(new Date(TODAY));
	events = $state<CalEvent[]>(EVENTS);
	vis = $state<Record<string, boolean>>(
		Object.fromEntries(CALENDARS.map((c) => [c.id, c.on]))
	);
	query = $state('');
	overlay = $state<Overlay>(null);
	rsvp = $state<Record<string, 'yes' | 'maybe' | 'no' | null>>({});
	navOpen = $state(false);
	toast = $state<string | null>(null);

	private toastTimer: ReturnType<typeof setTimeout> | undefined;

	shown = $derived.by(() => {
		const q = this.query.trim().toLowerCase();
		return this.events.filter(
			(e) => this.vis[e.cal] && (!q || (e.title + ' ' + (e.loc || '')).toLowerCase().includes(q))
		);
	});

	eventDays = $derived.by(() => {
		const s = new Set<string>();
		for (const e of this.shown) {
			s.add(e.day);
			if (e.endDay && e.endDay !== e.day) s.add(e.endDay);
		}
		return s;
	});

	days = $derived.by(() => {
		const c = this.cursor;
		if (this.view === 'day') return [new Date(c)];
		if (this.view === '4day') return [0, 1, 2, 3].map((i) => addDays(c, i));
		if (this.view === 'week') {
			const s = startOfWeek(c, opts.weekStartsMon);
			let arr = Array.from({ length: 7 }, (_, i) => addDays(s, i));
			if (!opts.showWeekends) arr = arr.filter((d) => d.getDay() !== 0 && d.getDay() !== 6);
			return arr;
		}
		return [new Date(c)];
	});

	title = $derived.by((): { main: string; sub: string } => {
		const c = this.cursor;
		const v = this.view;
		if (v === 'year') return { main: String(c.getFullYear()), sub: '' };
		if (v === 'month' || v === 'schedule')
			return { main: MONTH_NAMES[c.getMonth()], sub: String(c.getFullYear()) };
		const ds = this.days;
		const first = ds[0];
		const last = ds[ds.length - 1];
		if (v === 'day')
			return { main: `${MONTH_NAMES[first.getMonth()]} ${first.getDate()}`, sub: String(first.getFullYear()) };
		if (first.getMonth() === last.getMonth())
			return { main: MONTH_NAMES[first.getMonth()], sub: String(first.getFullYear()) };
		if (first.getFullYear() === last.getFullYear())
			return { main: `${MONTH_ABBR[first.getMonth()]} – ${MONTH_ABBR[last.getMonth()]}`, sub: String(first.getFullYear()) };
		return {
			main: `${MONTH_ABBR[first.getMonth()]} ${first.getFullYear()} – ${MONTH_ABBR[last.getMonth()]} ${last.getFullYear()}`,
			sub: ''
		};
	});

	setView = (v: View) => {
		this.view = v;
	};
	setQuery = (q: string) => {
		this.query = q;
	};
	toggleCal = (id: string) => {
		this.vis = { ...this.vis, [id]: !this.vis[id] };
	};

	step = (dir: number) => {
		const c = this.cursor;
		const v = this.view;
		if (v === 'day') this.cursor = addDays(c, dir);
		else if (v === '4day') this.cursor = addDays(c, dir * 4);
		else if (v === 'week' || v === 'schedule') this.cursor = addDays(c, dir * 7);
		else if (v === 'month') this.cursor = new Date(c.getFullYear(), c.getMonth() + dir, 1);
		else if (v === 'year') this.cursor = new Date(c.getFullYear() + dir, c.getMonth(), 1);
	};
	goToday = () => {
		this.cursor = new Date(TODAY);
	};
	goDay = (d: Date) => {
		this.cursor = new Date(d);
		this.view = 'day';
	};
	pickDate = (d: Date) => {
		this.cursor = new Date(d);
		this.navOpen = false;
	};
	gotoMonth = (m: number) => {
		this.cursor = new Date(this.cursor.getFullYear(), m, 1);
		this.view = 'month';
	};

	openEvent = (ev: CalEvent, el: HTMLElement | null) => {
		this.overlay = { type: 'popover', ev, rect: rectOf(el) };
	};
	openSlot = (day: Date, min: number | null, el: HTMLElement | null) => {
		this.overlay = { type: 'quick', draft: draftFromSlot(day, min), rect: rectOf(el) };
	};
	openCreate = (kind: 'event' | 'quick' | 'task' | 'focus') => {
		if (kind === 'event') {
			this.overlay = { type: 'dialog', initial: draftFromSlot(this.cursor, null), isEdit: false };
		} else {
			const k: DraftKind = kind === 'quick' ? 'event' : kind;
			this.overlay = {
				type: 'quick',
				draft: { ...draftFromSlot(this.cursor, null), kind: k },
				rect: rectOf(null)
			};
		}
	};
	closeOverlay = () => {
		this.overlay = null;
	};

	patchDraft = (patch: Partial<Draft>) => {
		const o = this.overlay;
		if (o?.type === 'quick') this.overlay = { ...o, draft: { ...o.draft, ...patch } };
	};

	editFromPopover = () => {
		const o = this.overlay;
		if (o?.type === 'popover') this.overlay = { type: 'dialog', initial: eventToDraft(o.ev), isEdit: true };
	};
	quickToDialog = () => {
		const o = this.overlay;
		if (o?.type === 'quick') this.overlay = { type: 'dialog', initial: o.draft, isEdit: false };
	};

	setRsvp = (id: string, r: 'yes' | 'maybe' | 'no') => {
		this.rsvp = { ...this.rsvp, [id]: this.rsvp[id] === r ? null : r };
		this.flash(r === 'yes' ? 'Going' : r === 'maybe' ? 'Replied maybe' : 'Declined');
	};

	saveEvent = (draft: Draft) => {
		const e = draftToEvent(draft, draft._id);
		this.events = draft._id
			? this.events.map((x) => (x.id === draft._id ? e : x))
			: [...this.events, e];
		this.flash(draft._id ? 'Event updated' : 'Event created');
		this.closeOverlay();
	};
	deleteEvent = (id: string | undefined) => {
		if (!id) return;
		this.events = this.events.filter((x) => x.id !== id);
		this.flash('Event deleted');
		this.closeOverlay();
	};

	flash = (text: string) => {
		this.toast = text;
		clearTimeout(this.toastTimer);
		this.toastTimer = setTimeout(() => (this.toast = null), 2400);
	};
}

export const cal = new CalendarState();
