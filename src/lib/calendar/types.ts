import type { Component } from 'svelte';

export type ItemKind = 'event' | 'task' | 'hold' | 'prop';

export type CalendarGroup = 'mine' | 'role' | 'other';

export type CalendarId =
	| 'personal'
	| 'family'
	| 'thelema'
	| 'infra'
	| 'school'
	| 'bookings'
	| 'holidays'
	| 'gcal';

export interface CalendarDef {
	name: string;
	color: string;
	group: CalendarGroup;
	badge?: string;
	readOnly?: boolean;
}

export type PersonId = 'you' | 'marie' | 'alex' | 'jules' | 'colette' | 'panurge';

export interface Person {
	init: string;
	name: string;
	full: string;
	email: string;
	bg: string;
	fg: string;
	external?: boolean;
}

export interface Item {
	id: string;
	kind: ItemKind;
	cal: CalendarId;
	title: string;
	day: number;
	start: string;
	end: string;
	loc?: string;
	video?: boolean;
	guests?: PersonId[];
	organizer?: PersonId;
	owner?: PersonId;
	due?: string;
	est?: string;
	rsvp?: boolean;
	external?: boolean;
	buffer?: number;
	fromMail?: boolean;
	thread?: string;
}

export interface AllDayItem {
	id: string;
	cal: CalendarId;
	title: string;
	day: number;
	span: number;
	solid?: boolean;
	fromMail?: boolean;
}

export interface TaskFixture {
	group: string;
	id: string;
	cal: CalendarId;
	title: string;
	due: string;
	est: string;
	owner: string;
	late?: boolean;
	roll?: string;
	boxed?: boolean;
	fromMail?: boolean;
}

export interface AgendaRowFixture {
	cal: CalendarId;
	time: string;
	title: string;
	sub: string;
	owner: PersonId | null;
	ack: PersonId[];
}

export interface AgendaDayFixture {
	day: number;
	rows: AgendaRowFixture[];
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

export type BoundaryTone = 'yes' | 'no' | 'warn';

export interface BoundaryLine {
	tone: BoundaryTone;
	text: string;
	mono?: string;
	icon?: Component;
}

export interface Selection {
	title: string;
	whenLong: string;
	loc: string | null;
	thread: string | null;
	calName: string;
	organizer: string;
	guests: { init: string; name: string; sub: string; bg: string; fg: string }[] | null;
	boundary: BoundaryLine[];
	prov: string;
	provSub: string;
	rsvp: boolean;
	color: string;
}

export type View = 'week' | 'month' | 'agenda' | 'avail' | 'booking';

export type Rsvp = 'yes' | 'maybe' | 'no';

export type PrivacyMode = 'private' | 'busy' | 'shared';
