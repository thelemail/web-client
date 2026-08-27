import { setMessageRsvp } from '$lib/api/messages';
import { dispatchSend } from '$lib/mail/sendDispatch';
import type { CalendarEvent } from '$lib/mail/render/icalParse';
import type { RsvpStatus } from '$lib/api/types';
import type { Message } from '$lib/mail/data';
import { buildIcsReply } from './buildIcsReply';
import { auth } from '$lib/stores/auth.svelte';

export interface SendRsvpInput {
	message: Message;
	event: CalendarEvent;
	status: RsvpStatus;
}

export async function sendRsvp({ message, event, status }: SendRsvpInput): Promise<void> {
	if (!event.uid) {
		throw new Error('Calendar event is missing UID — cannot persist RSVP.');
	}

	await setMessageRsvp(message.id, { status, eventUid: event.uid });

	const organizer = (event.organizer ?? '').trim();
	if (!organizer) return;

	const myEmail = auth.email ?? '';
	if (!myEmail) {
		throw new Error('Cannot send RSVP reply: signed-out account.');
	}
	const reply = buildIcsReply({
		source: event,
		myEmail,
		myName: auth.fullName ?? undefined,
		status
	});

	const subject = `${reply.subjectPrefix}: ${event.summary || '(event)'}`.slice(0, 200);
	const body = textBodyFor(status, event);
	await dispatchSend({
		to: [
			{ display: event.organizerName ?? organizer.split('@')[0], address: organizer }
		],
		subject,
		body,
		calendar: { method: 'REPLY', ics: reply.ics }
	});
}

function textBodyFor(status: RsvpStatus, event: CalendarEvent): string {
	const what = event.summary ? `"${event.summary}"` : 'the event';
	switch (status) {
		case 'accepted':
			return `I will attend ${what}.`;
		case 'tentative':
			return `I may attend ${what} — I'll confirm closer to the time.`;
		case 'declined':
			return `I am unable to attend ${what}.`;
	}
}
