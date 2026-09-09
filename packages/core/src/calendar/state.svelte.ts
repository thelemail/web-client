import { accountSettings } from '$core/stores/accountSettings.svelte';
import { addresses } from '$core/stores/addresses.svelte';
import { auth } from '$core/stores/auth.svelte';
import { workspaces } from '$core/stores/workspaces.svelte';
import { describeOccurrence, type DescribeContext } from './describe';
import { sendReply } from './invite';
import {
	clockLabel,
	dateLabel,
	dayNumber,
	dayOfWeekLabel,
	durationLabel,
	monthName,
	monthShort,
	rangeTitle,
	relativeDue,
	shortTime,
	timeLabel,
	year
} from './format';
import { packAllDay, packDay } from './layout';
import type { CalendarItem, ItemKind, Partstat } from './model';
import { isAllDay } from './model';
import {
	agendaRange,
	isWeekend,
	monthRange,
	shiftAnchor,
	today,
	weekRange,
	type DayRange
} from './range';
import type { Occurrence } from './recur';
import { calendarStore, type CalendarView, type LoadedItem } from './store.svelte';
import { deviceTimeZone, instantToDate, instantToWall, whenDate, zoneAbbreviation } from './tz';
import type {
	CalendarDef,
	CalendarDialogRequest,
	CalendarGroup,
	EditorRequest,
	ScopeRequest,
	Selection,
	View
} from './types';

export const HOUR_HEIGHT = 48;

export interface MonthEntry {
	key: string;
	title: string;
	time: string | null;
	allDay: boolean;
	color: string;
	occ: Occurrence;
}

export interface MonthCell {
	date: string;
	n: number;
	outside: boolean;
	weekend: boolean;
	today: boolean;
	entries: MonthEntry[];
	more: string | null;
}

export interface WeekBlock {
	id: string;
	kind: ItemKind;
	color: string;
	top: number;
	height: number;
	inset: number;
	depth: number;
	density: 'full' | 'oneline' | 'tiny';
	done: boolean;
	pending: boolean;
	title: string;
	when: string;
	occ: Occurrence;
}

export interface WeekDay {
	date: string;
	dow: string;
	num: number;
	today: boolean;
	weekend: boolean;
	blocks: WeekBlock[];
}

export interface AllDayRow {
	key: string;
	title: string;
	color: string;
	day: number;
	span: number;
	solid: boolean;
	row: number;
	occ: Occurrence;
}

export interface AgendaRow {
	key: string;
	color: string;
	time: string;
	title: string;
	sub: string;
	ownerName: string | null;
	ownerInit: string;
	ownerLabel: string;
	seen: boolean;
	seenLabel: string;
	occ: Occurrence;
}

export interface AgendaDay {
	date: string;
	dow: string;
	num: number;
	month: string;
	rows: AgendaRow[];
}

export interface TaskRowView {
	id: string;
	title: string;
	due: string;
	est: string;
	owner: string;
	late: boolean;
	roll: string | null;
	boxed: boolean;
	fromMail: boolean;
	done: boolean;
	color: string;
	entry: LoadedItem;
}

export interface TaskGroupView {
	name: string;
	rows: TaskRowView[];
}

export interface MiniDay {
	date: string;
	n: number;
	outside: boolean;
	today: boolean;
	inWeek: boolean;
	dot: boolean;
}

const TASK_GROUP_ORDER = ['Overdue', 'Today', 'This week', 'Later', 'No date'];

function dayIndex(range: DayRange, date: string): number {
	return range.dates.indexOf(date);
}

function initialsOf(name: string): string {
	const parts = name.split(/[\s@.]+/).filter(Boolean);
	return (
		((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || name.slice(0, 2).toUpperCase()
	);
}

class CalendarState {
	view = $state<View>('week');
	anchor = $state(today());
	query = $state('');
	navOpen = $state(false);
	tasksOpen = $state(false);
	fullDay = $state(false);
	dialog = $state<'mail' | 'offer' | 'sync' | 'editor' | 'calendar' | 'scope' | 'history' | null>(
		null
	);
	history = $state<{ itemId: string } | null>(null);
	editor = $state<EditorRequest | null>(null);
	calendarDialog = $state<CalendarDialogRequest | null>(null);
	scope = $state<ScopeRequest | null>(null);
	toast = $state<string | null>(null);
	now = $state(new Date());

	#toastTimer: ReturnType<typeof setTimeout> | undefined;
	#clock: ReturnType<typeof setInterval> | undefined;

	startClock(): () => void {
		if (!this.#clock) {
			this.#clock = setInterval(() => (this.now = new Date()), 30_000);
		}
		return () => {
			if (this.#clock) clearInterval(this.#clock);
			this.#clock = undefined;
		};
	}

	notify(message: string) {
		clearTimeout(this.#toastTimer);
		this.toast = message;
		this.#toastTimer = setTimeout(() => (this.toast = null), 3200);
	}

	get timeZone(): string {
		return deviceTimeZone();
	}

	get zoneLabel(): string {
		return zoneAbbreviation(this.timeZone, this.now);
	}

	get today(): string {
		return instantToDate(this.now, this.timeZone);
	}

	get weekStartsOn(): 0 | 1 {
		return accountSettings.calendar.weekStartsOn;
	}

	get startHour(): number {
		return this.fullDay ? 0 : accountSettings.calendar.startHour;
	}

	get isDated() {
		return (
			this.view === 'week' ||
			this.view === 'month' ||
			this.view === 'agenda' ||
			this.view === 'avail'
		);
	}

	goTo(view: View) {
		this.view = view;
		this.dialog = null;
		this.navOpen = false;
	}

	goToDate(date: string, view?: View) {
		this.anchor = date;
		if (view) this.goTo(view);
	}

	goToday() {
		this.anchor = this.today;
		if (!this.isDated) this.goTo('week');
	}

	prev() {
		if (!this.isDated) return;
		this.anchor = shiftAnchor(this.anchor, this.view === 'month' ? 'month' : 'week', -1);
	}

	next() {
		if (!this.isDated) return;
		this.anchor = shiftAnchor(this.anchor, this.view === 'month' ? 'month' : 'week', 1);
	}

	get weekWindow(): DayRange {
		return weekRange(this.anchor, this.weekStartsOn, this.timeZone);
	}

	get monthWindow() {
		return monthRange(this.anchor, this.weekStartsOn, this.timeZone);
	}

	get agendaWindow(): DayRange {
		return agendaRange(this.weekWindow.startDate, 7, this.timeZone);
	}

	get range(): DayRange {
		switch (this.view) {
			case 'month':
				return this.monthWindow;
			case 'agenda':
				return this.agendaWindow;
			default:
				return this.weekWindow;
		}
	}

	#matchesQuery(occ: Occurrence): boolean {
		const q = this.query.trim().toLowerCase();
		if (!q) return true;
		const hay = [occ.title, occ.location, occ.notes, occ.item.threadSubject]
			.filter(Boolean)
			.join(' ')
			.toLowerCase();
		return hay.includes(q);
	}

	occurrencesIn(range: DayRange): Occurrence[] {
		return calendarStore.occurrencesIn(range.from, range.to).filter((o) => this.#matchesQuery(o));
	}

	get occurrences(): Occurrence[] {
		return this.occurrencesIn(this.range);
	}

	#isBanded(occ: Occurrence): boolean {
		if (occ.allDay) return true;
		return occ.end.getTime() - occ.start.getTime() >= 24 * 60 * 60 * 1000;
	}

	get days(): WeekDay[] {
		const range = this.weekWindow;
		const offset = this.startHour * 60;
		const tz = this.timeZone;
		const timed = this.occurrencesIn(range).filter((o) => !this.#isBanded(o));
		return range.dates.map((date) => {
			const dayOccs = timed
				.map((occ) => {
					const startWall = instantToWall(occ.start, tz);
					const endWall = instantToWall(occ.end, tz);
					const startsHere = startWall.slice(0, 10) === date;
					const endsHere = endWall.slice(0, 10) === date;
					if (!startsHere && !endsHere) return null;
					const startMin = startsHere
						? Number(startWall.slice(11, 13)) * 60 + Number(startWall.slice(14, 16))
						: 0;
					const endMin = endsHere
						? Number(endWall.slice(11, 13)) * 60 + Number(endWall.slice(14, 16))
						: 24 * 60;
					return { occ, startMin, endMin: Math.max(endMin, startMin + 15) };
				})
				.filter((x): x is { occ: Occurrence; startMin: number; endMin: number } => x !== null);
			const placed = packDay(dayOccs);
			return {
				date,
				dow: dayOfWeekLabel(date).toUpperCase(),
				num: dayNumber(date),
				today: date === this.today,
				weekend: isWeekend(date),
				blocks: placed.map(({ item, column, columns }) => {
					const cal = calendarStore.calendar(item.occ.item.calendarId);
					const top = ((item.startMin - offset) / 60) * HOUR_HEIGHT;
					const height = Math.max(18, ((item.endMin - item.startMin) / 60) * HOUR_HEIGHT - 2);
					const loaded = calendarStore.item(item.occ.item.id);
					return {
						id: item.occ.key,
						kind: item.occ.item.kind,
						color: cal?.color ?? '#2E5440',
						top,
						height,
						inset: Math.min(16, 44 / Math.max(1, columns - 1)) * column,
						depth: column,
						density: height < 40 ? 'tiny' : height < 56 ? 'oneline' : 'full',
						done: item.occ.done,
						pending: !!loaded?.pending,
						title: item.occ.item.kind === 'hold' ? 'Busy' : item.occ.title || '(untitled)',
						when: this.#whenLabel(item.occ, item.startMin, item.endMin, height),
						occ: item.occ
					} satisfies WeekBlock;
				})
			};
		});
	}

	#whenLabel(occ: Occurrence, startMin: number, endMin: number, height: number): string {
		const item = occ.item;
		if (item.kind === 'hold') return 'private hold';
		if (item.kind === 'task') {
			const est = item.estimateMinutes ? durationLabel(item.estimateMinutes) : '';
			if (height < 40) return est;
			const due = item.due ? `due ${relativeDue(whenDate(item.due), this.today)}` : 'no deadline';
			return est ? `${due} · ${est}` : due;
		}
		if (height < 40) return timeLabel(startMin);
		return `${timeLabel(startMin)} – ${timeLabel(endMin)}`;
	}

	get allDayRows(): AllDayRow[] {
		const range = this.weekWindow;
		const tz = this.timeZone;
		const banded = this.occurrencesIn(range)
			.filter((o) => this.#isBanded(o))
			.map((occ) => {
				const startDate = occ.allDay
					? occ.startWall.slice(0, 10)
					: instantToWall(occ.start, tz).slice(0, 10);
				const endDate = occ.allDay
					? occ.endWall.slice(0, 10)
					: instantToWall(occ.end, tz).slice(0, 10);
				const first = Math.max(
					0,
					dayIndex(range, startDate) === -1
						? startDate < range.startDate
							? 0
							: 7
						: dayIndex(range, startDate)
				);
				let lastIdx = dayIndex(range, endDate);
				if (lastIdx === -1) lastIdx = endDate > range.endDate ? 7 : 0;
				const span = Math.max(1, Math.min(7, lastIdx) - first || 1);
				const cal = calendarStore.calendar(occ.item.calendarId);
				return {
					key: occ.key,
					title: occ.item.kind === 'hold' ? 'Busy' : occ.title || '(untitled)',
					color: cal?.color ?? '#2E5440',
					day: first,
					span: Math.min(span, 7 - first),
					solid: span > 1,
					occ
				};
			})
			.filter((row) => row.day < 7);
		return packAllDay(banded);
	}

	get hours() {
		return Array.from({ length: 23 - this.startHour }, (_, k) => ({
			label: timeLabel((this.startHour + k + 1) * 60),
			top: (k + 1) * HOUR_HEIGHT
		}));
	}

	get gridHeight() {
		return (24 - this.startHour) * HOUR_HEIGHT;
	}

	get nowMinutes(): number {
		const wall = instantToWall(this.now, this.timeZone);
		return Number(wall.slice(11, 13)) * 60 + Number(wall.slice(14, 16));
	}

	get nowTop() {
		return ((this.nowMinutes - this.startHour * 60) / 60) * HOUR_HEIGHT;
	}

	get nowLabel(): string {
		return clockLabel(this.now, this.timeZone);
	}

	get miniMonthLabel(): string {
		return `${monthName(this.anchor)} ${year(this.anchor)}`;
	}

	get miniDays(): MiniDay[] {
		const month = this.monthWindow;
		const week = this.weekWindow;
		const busy = new Set<string>();
		for (const occ of calendarStore.occurrencesIn(month.from, month.to)) {
			const date = occ.allDay
				? occ.startWall.slice(0, 10)
				: instantToWall(occ.start, this.timeZone).slice(0, 10);
			busy.add(date);
		}
		return month.dates.map((date) => ({
			date,
			n: dayNumber(date),
			outside: date < month.monthStart || date > month.monthEnd,
			today: date === this.today,
			inWeek: this.view !== 'month' && date >= week.startDate && date < week.endDate,
			dot: busy.has(date)
		}));
	}

	get monthCells(): MonthCell[] {
		const month = this.monthWindow;
		const tz = this.timeZone;
		const byDate = new Map<string, MonthEntry[]>();
		for (const occ of this.occurrencesIn(month)) {
			const cal = calendarStore.calendar(occ.item.calendarId);
			const color = cal?.color ?? '#2E5440';
			const startDate = occ.allDay
				? occ.startWall.slice(0, 10)
				: instantToWall(occ.start, tz).slice(0, 10);
			const endDate = occ.allDay
				? occ.endWall.slice(0, 10)
				: instantToWall(occ.end, tz).slice(0, 10);
			const banded = this.#isBanded(occ);
			const dates = banded
				? month.dates.filter(
						(d) => d >= startDate && (d < endDate || (d === startDate && endDate <= startDate))
					)
				: [startDate];
			for (const date of dates) {
				const list = byDate.get(date) ?? [];
				list.push({
					key: `${occ.key}@${date}`,
					title: occ.item.kind === 'hold' ? 'Busy' : occ.title || '(untitled)',
					time: banded ? null : shortTime(occ.start, tz),
					allDay: banded,
					color,
					occ
				});
				byDate.set(date, list);
			}
		}
		return month.dates.map((date, k) => {
			const entries = (byDate.get(date) ?? []).sort(
				(a, b) =>
					Number(!a.allDay) - Number(!b.allDay) || a.occ.start.getTime() - b.occ.start.getTime()
			);
			const cap = entries.length > 3 ? 2 : 3;
			return {
				date,
				n: dayNumber(date),
				outside: date < month.monthStart || date > month.monthEnd,
				weekend: k % 7 >= 5,
				today: date === this.today,
				entries: entries.slice(0, cap),
				more: entries.length > cap ? `+${entries.length - cap} more` : null
			};
		});
	}

	get memberNames(): Map<string, string> {
		const map = new Map<string, string>();
		for (const m of workspaces.members) map.set(m.email.toLowerCase(), m.fullName || m.email);
		return map;
	}

	get myAddresses(): string[] {
		const out = addresses.items.map((a) => a.email.toLowerCase());
		if (auth.email) out.push(auth.email.toLowerCase());
		return out;
	}

	get agendaDays(): AgendaDay[] {
		const range = this.agendaWindow;
		const tz = this.timeZone;
		const byDate = new Map<string, AgendaRow[]>();
		for (const occ of this.occurrencesIn(range)) {
			const item = occ.item;
			const cal = calendarStore.calendar(item.calendarId);
			const date = occ.allDay
				? occ.startWall.slice(0, 10)
				: instantToWall(occ.start, tz).slice(0, 10);
			if (date < range.startDate || date >= range.endDate) continue;
			const state = calendarStore.myState(item.id);
			const seen = !!state?.ack;
			const ownerName =
				item.owner?.name ||
				(item.owner
					? (this.memberNames.get(item.owner.email.toLowerCase()) ?? item.owner.email)
					: null);
			const subParts: string[] = [];
			if (item.rrule) subParts.push('Recurring');
			if (item.organizer && !this.myAddresses.includes(item.organizer.email.toLowerCase())) {
				subParts.push(`Organised by ${item.organizer.name ?? item.organizer.email}`);
			}
			if (item.kind === 'task') subParts.push(item.sourceMessageId ? 'Task · from mail' : 'Task');
			if (occ.location) subParts.push(occ.location);
			if (item.attendees?.length)
				subParts.push(`${item.attendees.length} guest${item.attendees.length === 1 ? '' : 's'}`);
			const rows = byDate.get(date) ?? [];
			rows.push({
				key: occ.key,
				color: cal?.color ?? '#2E5440',
				time: occ.allDay ? 'All day' : shortTime(occ.start, tz),
				title: item.kind === 'hold' ? 'Busy' : occ.title || '(untitled)',
				sub: subParts.join(' · ') || cal?.name || '',
				ownerName,
				ownerInit: ownerName ? initialsOf(ownerName) : '',
				ownerLabel: ownerName ? `${ownerName} owns this` : 'Needs an owner',
				seen,
				seenLabel: seen ? 'You have seen it' : 'Mark seen',
				occ
			});
			byDate.set(date, rows);
		}
		return range.dates
			.filter((date) => byDate.has(date))
			.map((date) => ({
				date,
				dow: dayOfWeekLabel(date).toUpperCase(),
				num: dayNumber(date),
				month: monthName(date),
				rows: (byDate.get(date) ?? []).sort((a, b) => a.occ.start.getTime() - b.occ.start.getTime())
			}));
	}

	get taskGroups(): TaskGroupView[] {
		const groups = new Map<string, TaskRowView[]>();
		const week = this.weekWindow;
		for (const entry of calendarStore.tasks()) {
			const item = entry.item;
			if (item.done) continue;
			const cal = calendarStore.calendar(item.calendarId);
			const dueDate = item.due ? whenDate(item.due) : null;
			let group = 'No date';
			if (dueDate) {
				if (dueDate < this.today) group = 'Overdue';
				else if (dueDate === this.today) group = 'Today';
				else if (dueDate < week.endDate) group = 'This week';
				else group = 'Later';
			}
			const owner =
				item.owner?.name ||
				(item.owner
					? (this.memberNames.get(item.owner.email.toLowerCase()) ?? item.owner.email)
					: 'Unassigned');
			const rows = groups.get(group) ?? [];
			rows.push({
				id: item.id,
				title: item.title || '(untitled)',
				due: dueDate ? relativeDue(dueDate, this.today) : 'No date',
				est: item.estimateMinutes ? durationLabel(item.estimateMinutes) : '',
				owner,
				late: !!dueDate && dueDate < this.today,
				roll: item.rolloverCount
					? `${item.rolloverCount}${item.rolloverCount === 1 ? 'st' : item.rolloverCount === 2 ? 'nd' : item.rolloverCount === 3 ? 'rd' : 'th'} rollover`
					: null,
				boxed: !!item.start && !!item.end,
				fromMail: !!item.sourceMessageId,
				done: !!item.done,
				color: cal?.color ?? '#2E5440',
				entry
			});
			groups.set(group, rows);
		}
		return TASK_GROUP_ORDER.filter((name) => groups.has(name)).map((name) => ({
			name,
			rows: (groups.get(name) ?? []).sort((a, b) => a.due.localeCompare(b.due))
		}));
	}

	get agendaBadge(): number {
		let unseen = 0;
		for (const occ of this.occurrencesIn(this.agendaWindow)) {
			const cal = calendarStore.calendar(occ.item.calendarId);
			if (!cal || cal.kind === 'personal' || occ.item.kind === 'hold') continue;
			if (!calendarStore.myState(occ.item.id)?.ack) unseen += 1;
		}
		return unseen;
	}

	get taskCount() {
		const open = calendarStore.tasks().filter((t) => !t.item.done).length;
		return `${open} open`;
	}

	get capacity(): { committed: number; boxed: number; total: number } {
		const week = this.weekWindow;
		let committed = 0;
		let boxed = 0;
		for (const occ of calendarStore.occurrencesIn(week.from, week.to)) {
			if (occ.allDay) continue;
			const mins = (occ.end.getTime() - occ.start.getTime()) / 60000;
			if (occ.item.kind === 'task') boxed += mins;
			else committed += mins;
		}
		return { committed: Math.round(committed / 60), boxed: Math.round(boxed / 60), total: 40 };
	}

	get title() {
		switch (this.view) {
			case 'week':
				return rangeTitle(this.weekWindow.startDate, this.weekWindow.endDate);
			case 'month':
				return monthName(this.anchor);
			case 'agenda': {
				const w = this.weekWindow;
				return w.startDate <= this.today && this.today < w.endDate
					? 'This week'
					: rangeTitle(w.startDate, w.endDate);
			}
			case 'avail':
				return 'Availability';
			case 'booking':
				return 'Booking pages';
		}
	}

	get titleYear() {
		return this.view === 'week' || this.view === 'month' ? String(year(this.anchor)) : '';
	}

	calendarsIn(group: CalendarGroup): CalendarDef[] {
		const hidden = new Set(accountSettings.calendar.hidden);
		return calendarStore.calendars
			.filter((c) =>
				group === 'role' ? c.kind === 'role' : group === 'mine' ? c.kind !== 'role' : false
			)
			.map((c) => ({
				id: c.id,
				name: c.name,
				color: c.color,
				group,
				badge: this.#badgeFor(c),
				readOnly: !c.canWrite,
				on: !hidden.has(c.id)
			}));
	}

	#badgeFor(cal: CalendarView): string | undefined {
		if (cal.rotationRequired && cal.canManage) return 'key';
		if (cal.kind === 'personal') return undefined;
		let unseen = 0;
		for (const entry of calendarStore.items.values()) {
			if (entry.item.calendarId !== cal.id || entry.unreadable) continue;
			if (entry.item.kind === 'hold') continue;
			if (!calendarStore.myState(entry.item.id)?.ack) unseen += 1;
		}
		return unseen ? String(unseen) : undefined;
	}

	toggleCalendar(id: string) {
		const current = accountSettings.calendar;
		const hidden = current.hidden.includes(id)
			? current.hidden.filter((x) => x !== id)
			: [...current.hidden, id];
		void accountSettings.persistCalendar({ ...current, hidden }).catch(() => {});
	}

	describe(occ: Occurrence): Selection {
		const loaded = calendarStore.item(occ.item.id);
		const ctx: DescribeContext = {
			calendar: calendarStore.calendar(occ.item.calendarId),
			myAddresses: this.myAddresses,
			myState: calendarStore.myState(occ.item.id),
			memberNames: this.memberNames,
			offline: !calendarStore.online,
			pending: !!loaded?.pending,
			rev: loaded?.rev ?? 0,
			updatedAt: loaded?.updatedAt ?? occ.item.updatedAt
		};
		return describeOccurrence(occ, ctx);
	}

	openEditor(request: EditorRequest) {
		this.editor = request;
		this.dialog = 'editor';
	}

	closeEditor() {
		if (this.dialog === 'editor') this.dialog = null;
		this.editor = null;
	}

	openCalendarDialog(request: CalendarDialogRequest) {
		this.calendarDialog = request;
		this.dialog = 'calendar';
	}

	openHistory(itemId: string) {
		this.history = { itemId };
		this.dialog = 'history';
	}

	requestScope(request: ScopeRequest) {
		this.scope = request;
		this.dialog = 'scope';
	}

	async toggleTask(entry: LoadedItem) {
		const next: CalendarItem = { ...entry.item, done: !entry.item.done };
		try {
			await calendarStore.saveItem(next, {
				fields: ['done'],
				label: `${next.done ? 'Completed' : 'Reopened'} “${next.title}”`
			});
		} catch (err) {
			this.notify(err instanceof Error ? err.message : 'Could not update the task');
		}
	}

	async toggleAck(itemId: string, current: boolean) {
		try {
			await calendarStore.setMyState(
				itemId,
				{ ack: current ? undefined : { at: new Date().toISOString() } },
				current ? 'Cleared acknowledgement' : 'Marked as seen'
			);
		} catch (err) {
			this.notify(err instanceof Error ? err.message : 'Could not save');
		}
	}

	async setPartstat(occ: Occurrence, partstat: Partstat): Promise<void> {
		const item = occ.item;
		const mine = new Set(this.myAddresses);
		const attendees = (item.attendees ?? []).map((a) =>
			mine.has(a.email.toLowerCase()) ? { ...a, partstat } : a
		);
		const next: CalendarItem = { ...item, attendees };
		try {
			await calendarStore.saveItem(next, {
				fields: ['partstat'],
				label: `Replied ${partstat} to “${item.title}”`
			});
			await calendarStore.setMyState(item.id, { partstat }, `Replied ${partstat}`);
			await sendReply(next, partstat, item.sourceMessageId);
			this.notify(
				calendarStore.online
					? `Replying ${partstat} · reply goes to ${item.organizer?.email ?? 'the organiser'}`
					: 'RSVP saved · queued until you reconnect'
			);
		} catch (err) {
			this.notify(err instanceof Error ? err.message : 'Could not save your reply');
		}
	}

	get systemBarText(): string {
		const s = calendarStore;
		if (s.halted) return s.halted;
		if (!s.online) {
			const since = s.offlineSince
				? shortTime(new Date(s.offlineSince), this.timeZone)
				: 'a moment ago';
			const n = s.pendingCount;
			return `Offline since ${since}. ${n ? `${n} local change${n === 1 ? '' : 's'} ${n === 1 ? 'is' : 'are'} waiting; nothing has been lost.` : 'Changes keep working and send when you reconnect.'}`;
		}
		if (s.blockedCount) {
			return `${s.blockedCount} change${s.blockedCount === 1 ? '' : 's'} need${s.blockedCount === 1 ? 's' : ''} your review before ${s.blockedCount === 1 ? 'it' : 'they'} can be sent.`;
		}
		const n = s.pendingCount;
		if (!n) return 'Connected. Every change on this device has reached Thelemail.';
		return `Connected. ${n} change${n === 1 ? '' : 's'} ${n === 1 ? 'is' : 'are'} still waiting ${n === 1 ? 'its' : 'their'} turn to send.`;
	}

	get systemBarTone(): 'warn' | 'info' {
		return !calendarStore.online || calendarStore.blockedCount > 0 || !!calendarStore.halted
			? 'warn'
			: 'info';
	}

	dateOf(occ: Occurrence): string {
		return occ.allDay
			? occ.startWall.slice(0, 10)
			: instantToWall(occ.start, this.timeZone).slice(0, 10);
	}

	labelForDate(date: string): string {
		return dateLabel(date);
	}

	monthShortOf(date: string): string {
		return monthShort(date);
	}

	isAllDay(item: CalendarItem): boolean {
		return isAllDay(item.start);
	}
}

export const cal = new CalendarState();
