import X from '@lucide/svelte/icons/x';
import { CALENDARS, PEOPLE } from './fixtures';
import { longWhen } from './format';
import type { AllDayItem, BoundaryLine, Item, Selection } from './types';

const KIND_LABEL: Record<Item['kind'], string> = {
	event: 'Event',
	task: 'Task',
	hold: 'Hold',
	prop: 'Proposal'
};

function boundaryFor(item: Item): BoundaryLine[] {
	if (item.kind === 'hold') {
		return [
			{
				tone: 'yes',
				text: 'A busy window only. This device holds the title; the server never had one.',
				mono: 'mirrored to: Thélème Co, Alex — Google'
			},
			{ tone: 'no', text: 'No title, location, guests or notes exist to leak.' }
		];
	}
	if (item.external) {
		return [
			{
				tone: 'warn',
				text: 'Sending title, time and location to one external invitee.',
				mono: 'panurge@quart-livre.example · plain iTIP, no key published'
			},
			{ tone: 'yes', text: 'Notes and the source thread stay encrypted and are not attached.' },
			{
				tone: 'yes',
				text: 'Organiser identity is the role address, not your personal one.',
				mono: 'from: bookings@thelema.co'
			}
		];
	}
	if (item.kind === 'prop') {
		return [
			{
				tone: 'warn',
				text: 'Three candidate times are already with R. Panurge.',
				mono: 'thelema.co/t/8kq2 · one-use · expires 24 Jun'
			},
			{ tone: 'no', text: 'Nothing is booked. This slot is held for you only, not for them.' }
		];
	}
	return [
		{
			tone: 'yes',
			text: `Encrypted for ${CALENDARS[item.cal].name} members. Reminders fire on your devices.`,
			mono: 'zero-access at rest · title, notes, guests'
		},
		{ tone: 'no', text: 'No availability is published from this event.' },
		{ tone: 'no', icon: X, text: 'Envelope metadata for invitations is visible, as with any mail.' }
	];
}

export function describeItem(item: Item): Selection {
	const calendar = CALENDARS[item.cal];
	const guests = (item.guests ?? []).map((id) => {
		const person = PEOPLE[id];
		return {
			init: person.init,
			name: person.full,
			sub: person.external ? `${person.email} · external, no account` : person.email,
			bg: person.bg,
			fg: person.fg
		};
	});
	return {
		title: item.kind === 'hold' ? 'Busy' : item.title,
		whenLong: longWhen(item.day, item.start, item.end, item.kind === 'task' ? ' · timeboxed' : ''),
		loc: item.loc ?? null,
		thread: item.thread ?? null,
		calName: `${KIND_LABEL[item.kind]} on ${calendar.name}`,
		organizer: item.organizer
			? `Organised by ${PEOPLE[item.organizer].full}`
			: item.kind === 'task' && item.owner
				? `Owner: ${PEOPLE[item.owner].full} · due ${item.due} · ${item.est}`
				: 'You are the organiser',
		guests: guests.length ? guests : null,
		boundary: boundaryFor(item),
		prov: item.external ? 'Organiser of record: Thelemail' : 'Thelemail · zero-access storage',
		provSub: item.external
			? 'External RSVP arrives as iTIP mail · last change 09:41'
			: 'Revision 4 · last edited by you at 10:02 · full history kept',
		rsvp: !!item.rsvp,
		color: calendar.color
	};
}

export function describeAllDay(entry: AllDayItem): Selection {
	return describeItem({
		id: entry.id,
		kind: 'event',
		cal: entry.cal,
		title: entry.title,
		day: entry.day,
		start: '00:00',
		end: '23:59'
	});
}
