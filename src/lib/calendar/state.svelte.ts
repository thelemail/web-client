import {
	AGENDA,
	ALL_DAY,
	ANSWERS,
	BOOKING_DAYS,
	CALENDARS,
	COUNT_WORDS,
	DAY_NUMS,
	DOW,
	ITEMS,
	MONTH_EXTRA,
	PEOPLE,
	SLOTS,
	TASKS,
	TASK_GROUPS
} from './fixtures';
import { count, dayLabel, minutes, shortTime } from './format';
import { packAllDay, packDay } from './layout';
import type {
	AllDayItem,
	CalendarGroup,
	CalendarId,
	Item,
	PrivacyMode,
	Rsvp,
	View
} from './types';

export const HOUR_HEIGHT = 48;
export const WEEK_FIRST_DAY = 15;
export const WEEK_LAST_DAY = 21;

export interface MonthEntry {
	title: string;
	time: string | null;
	allDay: boolean;
	color: string;
}

export interface MonthCell {
	n: number;
	outside: boolean;
	weekend: boolean;
	today: boolean;
	entries: MonthEntry[];
	more: string | null;
}

export interface WeekBlock {
	id: string;
	kind: Item['kind'];
	color: string;
	top: number;
	height: number;
	inset: number;
	depth: number;
	density: 'full' | 'oneline' | 'tiny';
	done: boolean;
	title: string;
	when: string;
	item: Item;
}

export interface WeekBuffer {
	top: number;
	height: number;
	label: string;
}

export interface WeekDay {
	dow: string;
	num: number;
	today: boolean;
	weekend: boolean;
	blocks: WeekBlock[];
	buffers: WeekBuffer[];
}

function allCalendarsOn(): Record<CalendarId, boolean> {
	const out = {} as Record<CalendarId, boolean>;
	for (const id of Object.keys(CALENDARS) as CalendarId[]) out[id] = true;
	return out;
}

class CalendarState {
	view = $state<View>('week');
	calendarOn = $state<Record<CalendarId, boolean>>(allCalendarsOn());
	query = $state('');
	navOpen = $state(false);
	tasksOpen = $state(false);
	offline = $state(false);
	fullDay = $state(false);
	dialog = $state<'mail' | 'offer' | 'sync' | null>(null);
	rsvp = $state<Rsvp | null>(null);
	doneTasks = $state<Record<string, boolean>>({});
	acknowledged = $state<Record<string, boolean>>({});
	mailSelected = $state<Record<string, boolean>>({ p1: true, p2: true, p3: true });
	mailOwner = $state<'marie' | 'you' | null>(null);
	mailDone = $state(false);
	offeredSlots = $state<number[]>([0, 1, 2]);
	privacyMode = $state<PrivacyMode>('busy');
	mirrors = $state({ work: true, school: true, gcal: true });
	bookingDay = $state(1);
	bookingSlot = $state<number | null>(null);
	bookingRequest = $state(false);
	toast = $state<string | null>(null);

	#toastTimer: ReturnType<typeof setTimeout> | undefined;

	notify(message: string) {
		clearTimeout(this.#toastTimer);
		this.toast = message;
		this.#toastTimer = setTimeout(() => (this.toast = null), 3200);
	}

	unbuilt() {
		this.notify('Not built in this mockup');
	}

	goTo(view: View) {
		this.view = view;
		this.dialog = null;
		this.navOpen = false;
	}

	toggleCalendar(id: CalendarId) {
		this.calendarOn = { ...this.calendarOn, [id]: !this.calendarOn[id] };
	}

	calendarsIn(group: CalendarGroup) {
		return (Object.keys(CALENDARS) as CalendarId[])
			.filter((id) => CALENDARS[id].group === group)
			.map((id) => ({ id, ...CALENDARS[id], on: this.calendarOn[id] }));
	}

	get startHour() {
		return this.fullDay ? 0 : 6;
	}

	get visibleItems(): Item[] {
		return ITEMS.filter(
			(item) => this.calendarOn[item.cal] && (!item.fromMail || this.mailDone)
		);
	}

	get visibleAllDay(): AllDayItem[] {
		return ALL_DAY.filter((item) => this.calendarOn[item.cal] && (!item.fromMail || this.mailDone));
	}

	get days(): WeekDay[] {
		const offset = this.startHour * 60;
		return DOW.map((dow, index) => {
			const dayItems = this.visibleItems.filter((item) => item.day === index);
			const placed = packDay(dayItems);
			return {
				dow,
				num: DAY_NUMS[index],
				today: index === 0,
				weekend: index > 4,
				buffers: dayItems
					.filter((item) => item.buffer)
					.map((item) => ({
						label: `${item.buffer} min travel`,
						top: ((minutes(item.start) - (item.buffer ?? 0) - offset) / 60) * HOUR_HEIGHT,
						height: ((item.buffer ?? 0) / 60) * HOUR_HEIGHT - 2
					})),
				blocks: placed.map(({ item, column, columns }) => {
					const top = ((minutes(item.start) - offset) / 60) * HOUR_HEIGHT;
					const height = Math.max(
						18,
						((minutes(item.end) - minutes(item.start)) / 60) * HOUR_HEIGHT - 2
					);
					return {
						id: item.id,
						kind: item.kind,
						color: CALENDARS[item.cal].color,
						top,
						height,
						inset: Math.min(16, 44 / Math.max(1, columns - 1)) * column,
						depth: column,
						density: height < 40 ? 'tiny' : height < 56 ? 'oneline' : 'full',
						done: !!this.doneTasks[item.id],
						title: item.kind === 'hold' ? 'Busy' : item.title,
						when: this.#whenLabel(item, height),
						item
					} satisfies WeekBlock;
				})
			};
		});
	}

	#whenLabel(item: Item, height: number) {
		if (item.kind === 'hold') return 'private hold';
		if (item.kind === 'prop') return '3 times offered';
		if (item.kind === 'task') {
			return height < 40 ? (item.est ?? '') : `due ${item.due} · ${item.est}`;
		}
		return height < 40 ? item.start : `${item.start} – ${item.end}`;
	}

	get allDayRows() {
		return packAllDay(this.visibleAllDay).map((item) => ({
			...item,
			color: CALENDARS[item.cal].color
		}));
	}

	get hours() {
		return Array.from({ length: 23 - this.startHour }, (_, k) => ({
			label: `${String(this.startHour + k + 1).padStart(2, '0')}:00`,
			top: (k + 1) * HOUR_HEIGHT
		}));
	}

	get gridHeight() {
		return (24 - this.startHour) * HOUR_HEIGHT;
	}

	get nowTop() {
		return ((10 * 60 + 24 - this.startHour * 60) / 60) * HOUR_HEIGHT;
	}

	get miniDays() {
		return Array.from({ length: 42 }, (_, k) => {
			const index = k + 1;
			const outside = index > 30;
			return {
				n: outside ? index - 30 : index,
				outside,
				today: index === WEEK_FIRST_DAY,
				inWeek: index >= WEEK_FIRST_DAY && index <= WEEK_LAST_DAY,
				dot: !outside && (index === 17 || index === 19 || index === 25 || index === 30)
			};
		});
	}

	get monthCells(): MonthCell[] {
		return Array.from({ length: 42 }, (_, k) => {
			const index = k + 1;
			const outside = index > 30;
			const entries: MonthEntry[] = [];
			if (!outside) {
				if (index >= WEEK_FIRST_DAY && index <= WEEK_LAST_DAY) {
					const day = index - WEEK_FIRST_DAY;
					for (const item of this.visibleAllDay.filter((a) => a.day === day)) {
						entries.push({
							title: item.title,
							time: null,
							allDay: true,
							color: CALENDARS[item.cal].color
						});
					}
					for (const item of this.visibleItems.filter((i) => i.day === day)) {
						entries.push({
							title: item.kind === 'hold' ? 'Busy' : item.title,
							time: shortTime(item.start),
							allDay: false,
							color: CALENDARS[item.cal].color
						});
					}
				} else {
					for (const [cal, title, time] of MONTH_EXTRA[index - 1] ?? []) {
						if (!this.calendarOn[cal]) continue;
						entries.push({
							title,
							time: time ? shortTime(time) : null,
							allDay: !time,
							color: CALENDARS[cal].color
						});
					}
				}
			}
			const cap = entries.length > 2 ? 1 : 2;
			return {
				n: outside ? index - 30 : index,
				outside,
				weekend: k % 7 > 4,
				today: index === WEEK_FIRST_DAY,
				entries: entries.slice(0, cap),
				more: entries.length > cap ? `+${entries.length - cap} more` : null
			};
		});
	}

	get agendaDays() {
		return AGENDA.map((day) => ({
			dow: DOW[day.day],
			num: DAY_NUMS[day.day],
			rows: day.rows.map((row, k) => {
				const key = `${day.day}-${k}`;
				const seen = this.acknowledged[key] ?? row.ack.includes('you');
				const owner = row.owner ? PEOPLE[row.owner] : null;
				return {
					key,
					color: CALENDARS[row.cal].color,
					time: row.time,
					title: row.title,
					sub: row.sub,
					owner,
					ownerLabel: owner ? `${owner.name} owns this` : 'Needs an owner',
					seen,
					seenLabel: seen ? 'You have seen it' : 'Mark seen'
				};
			})
		}));
	}

	get taskGroups() {
		return TASK_GROUPS.map((name) => ({
			name,
			rows: TASKS.filter((task) => task.group === name && (!task.fromMail || this.mailDone)).map(
				(task) => ({
					...task,
					color: CALENDARS[task.cal].color,
					done: !!this.doneTasks[task.id]
				})
			)
		})).filter((group) => group.rows.length);
	}

	get taskCount() {
		return `${TASKS.filter((task) => !task.fromMail || this.mailDone).length} open`;
	}

	toggleTask(id: string) {
		this.doneTasks = { ...this.doneTasks, [id]: !this.doneTasks[id] };
	}

	toggleAck(key: string, current: boolean) {
		this.acknowledged = { ...this.acknowledged, [key]: !current };
	}

	setRsvp(value: Rsvp) {
		this.rsvp = value;
		if (value === 'yes') {
			this.notify(
				this.offline
					? 'RSVP saved · queued until you reconnect'
					: 'Replying yes · iTIP sent to alex@meudon.fr'
			);
			return;
		}
		this.notify(value === 'maybe' ? 'Replying maybe' : 'Replying no');
	}

	toggleOffline() {
		const wasOffline = this.offline;
		this.offline = !wasOffline;
		this.dialog = null;
		this.notify(
			wasOffline ? 'Back online · queue drained' : 'Offline — local edits keep working'
		);
	}

	get systemBarText() {
		return this.offline
			? 'Offline since 09:57. Three local changes are waiting; nothing has been lost.'
			: 'Connected. Three changes made at 09:57 are still waiting their turn to send.';
	}

	get title() {
		return {
			week: '15 – 21 June',
			month: 'June',
			agenda: 'This week',
			avail: 'Availability',
			booking: 'Booking pages'
		}[this.view];
	}

	get titleYear() {
		return this.view === 'week' || this.view === 'month' ? '2026' : '';
	}

	get isDated() {
		return this.view === 'week' || this.view === 'month' || this.view === 'agenda';
	}

	toggleMailProposal(key: string) {
		this.mailSelected = { ...this.mailSelected, [key]: !this.mailSelected[key] };
	}

	get mailSelectedCount() {
		return Object.values(this.mailSelected).filter(Boolean).length;
	}

	get mailOwnerMissing() {
		return this.mailSelected.p2 && !this.mailOwner;
	}

	confirmMail() {
		if (this.mailOwnerMissing) {
			this.notify('Choose who owns the consent form first');
			return;
		}
		const n = this.mailSelectedCount;
		if (!n) return;
		this.dialog = null;
		this.mailDone = true;
		this.view = 'week';
		this.notify(`${n} commitments added · Marie owns the consent form`);
	}

	dropSlot(index: number) {
		this.offeredSlots = this.offeredSlots.filter((i) => i !== index);
	}

	addSlot() {
		const next = [0, 1, 2, 3].find((i) => !this.offeredSlots.includes(i));
		if (next === undefined) {
			this.notify('No further free slots this week');
			return;
		}
		this.offeredSlots = [...this.offeredSlots, next].sort();
	}

	get slotDisclosure() {
		const n = this.offeredSlots.length;
		return `${count(COUNT_WORDS, n)} candidate time${n === 1 ? '' : 's'}, your name, and the sending identity.`;
	}

	get whyHeading() {
		const n = this.offeredSlots.length;
		return `Why ${count(COUNT_WORDS, n)} time${n === 1 ? '' : 's'}`;
	}

	get hasTightSlot() {
		return this.offeredSlots.includes(2);
	}

	get pollColumns() {
		return this.offeredSlots.map((i) => {
			const when = SLOTS[i].when;
			const time = when.match(/\d\d:\d\d/)?.[0] ?? '';
			return { index: i, label: `${when.replace(/ June.*/, '').replace(/,.*/, '')} ${time}` };
		});
	}

	get pollRows() {
		return (['panurge', 'alex'] as const).map((key) => {
			const person = PEOPLE[key];
			return {
				key,
				init: person.init,
				name: person.full,
				external: !!person.external,
				bg: person.bg,
				fg: person.fg,
				cells: this.offeredSlots.map((i) => ({ index: i, yes: ANSWERS[key][i] }))
			};
		});
	}

	get pollNote() {
		const both = this.offeredSlots.filter((i) => ANSWERS.panurge[i] && ANSWERS.alex[i]);
		if (!both.length) {
			return 'No offered time works for both. Thelemail will suggest more rather than pick one.';
		}
		const when = SLOTS[both[0]].when;
		const label = when.replace(/,.*/, '') + when.slice(when.indexOf(','));
		const lead =
			both.length === 1
				? `${label} is the only time both can make.`
				: `${both.length} of the offered times work for both.`;
		return `${lead} Thelemail will not book it for you — it will offer to.`;
	}

	confirmOffer() {
		this.dialog = null;
		this.notify('Times inserted · a Proposal is holding them for you');
	}

	setPrivacyMode(mode: PrivacyMode) {
		this.privacyMode = mode;
		this.notify(
			{
				private: 'New commitments default to Private',
				busy: 'New commitments default to Busy-only',
				shared: 'New commitments default to Shared — fields are named before sending'
			}[mode]
		);
	}

	toggleMirror(key: 'work' | 'school' | 'gcal') {
		const was = this.mirrors[key];
		this.mirrors = { ...this.mirrors, [key]: !was };
		if (key === 'gcal') {
			this.notify(
				was ? 'Mirror off · Google keeps nothing new' : 'Busy windows will leave Thelemail for Google'
			);
		}
	}

	toggleBookingRequest() {
		const was = this.bookingRequest;
		this.bookingRequest = !was;
		this.bookingSlot = null;
		this.notify(
			was ? 'Visitors book directly again' : 'Visitors now request · each becomes a Proposal'
		);
	}

	pickBookingDay(index: number) {
		this.bookingDay = index;
		this.bookingSlot = null;
	}

	get bookingCta() {
		if (this.bookingSlot === null) return 'Pick a time';
		const slot = BOOKING_DAYS[this.bookingDay].slots[this.bookingSlot];
		return this.bookingRequest ? `Request ${slot}` : `Confirm ${slot}`;
	}

	confirmBooking() {
		if (this.bookingSlot === null) {
			this.notify('Pick a time first');
			return;
		}
		this.notify(
			this.bookingRequest
				? 'Request sent · a Proposal is waiting on bookings@thelema.co'
				: 'Booked · invitation sent as bookings@thelema.co'
		);
	}
}

export const cal = new CalendarState();
export { dayLabel, minutes, shortTime };
