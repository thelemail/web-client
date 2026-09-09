import type { Component } from 'svelte';
import type { CalendarItem, ItemKind, Partstat, Privacy } from './model';
import type { Occurrence } from './recur';

export type { CalendarItem, ItemKind, Partstat };

export type CalendarGroup = 'mine' | 'role' | 'other';

export interface CalendarDef {
	id: string;
	name: string;
	color: string;
	group: CalendarGroup;
	badge?: string;
	readOnly?: boolean;
	on: boolean;
}

export type BoundaryTone = 'yes' | 'no' | 'warn';

export interface BoundaryLine {
	tone: BoundaryTone;
	text: string;
	mono?: string;
	icon?: Component;
}

export interface GuestChip {
	init: string;
	name: string;
	sub: string;
	bg: string;
	fg: string;
	partstat: Partstat;
}

export interface Selection {
	title: string;
	whenLong: string;
	loc: string | null;
	video: string | null;
	notes: string | null;
	thread: string | null;
	calName: string;
	organizer: string;
	guests: GuestChip[] | null;
	boundary: BoundaryLine[];
	prov: string;
	provSub: string;
	rsvp: boolean;
	myPartstat: Partstat | null;
	color: string;
	canEdit: boolean;
	occ: Occurrence;
}

export type View = 'week' | 'month' | 'agenda' | 'avail' | 'booking';

export type Rsvp = 'yes' | 'maybe' | 'no';

export type PrivacyMode = Privacy;

export interface EditorRequest {
	mode: 'create' | 'edit' | 'duplicate';
	kind?: ItemKind;
	occ?: Occurrence;
	item?: CalendarItem;
	scope?: 'this' | 'all';
	prefill?: Partial<CalendarItem> & { date?: string; startWall?: string; endWall?: string };
}

export interface CalendarDialogRequest {
	mode: 'create' | 'edit' | 'share' | 'delete';
	calendarId?: string;
}

export interface ScopeRequest {
	occ: Occurrence;
	action: 'edit' | 'delete';
}
