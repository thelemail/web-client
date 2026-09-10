export interface IcalDateTime {
	display: string;
	iso: string;
	tzid?: string;
	allDay: boolean;
}

export interface CalendarEvent {
	summary?: string;
	location?: string;
	description?: string;
	organizer?: string;
	organizerName?: string;
	attendees: string[];
	attendeeNames?: Record<string, string>;
	start?: IcalDateTime;
	end?: IcalDateTime;
	method?: string;
	uid?: string;
	sequence?: number;
	dtstamp?: string;
	rawIcs?: string;
}

function unfoldLines(text: string): string[] {
	const raw = text.replace(/\r\n/g, '\n').split('\n');
	const out: string[] = [];
	for (const line of raw) {
		if ((line.startsWith(' ') || line.startsWith('\t')) && out.length > 0) {
			out[out.length - 1] += line.slice(1);
		} else {
			out.push(line);
		}
	}
	return out;
}

interface Prop {
	name: string;
	params: Record<string, string>;
	value: string;
}

function parseLine(line: string): Prop | null {
	const colon = line.indexOf(':');
	if (colon < 0) return null;
	const left = line.slice(0, colon);
	const value = line.slice(colon + 1);
	const parts = left.split(';');
	const name = (parts.shift() ?? '').toUpperCase();
	const params: Record<string, string> = {};
	for (const p of parts) {
		const eq = p.indexOf('=');
		if (eq < 0) continue;
		params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
	}
	return { name, params, value };
}

function unescapeText(s: string): string {
	return s.replace(/\\([,;n\\Nt])/g, (_, c) => {
		if (c === 'n' || c === 'N') return '\n';
		if (c === 't') return '\t';
		if (c === '\\') return '\\';
		return c;
	});
}

function parseAddress(value: string): string | undefined {
	const m = value.match(/^mailto:(.+)$/i);
	return m ? m[1] : value || undefined;
}

function parseIcsDate(value: string, tzid: string | undefined): IcalDateTime {
	const allDay = /^\d{8}$/.test(value);
	const utc = value.endsWith('Z');
	const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/);
	if (!m) {
		return { display: value, iso: value, tzid, allDay };
	}
	const [, y, mo, d, hh, mm, ss] = m;
	if (allDay) {
		const iso = `${y}-${mo}-${d}`;
		const date = new Date(`${iso}T00:00:00Z`);
		const display = isNaN(date.getTime())
			? iso
			: date.toLocaleDateString(undefined, {
				weekday: 'short',
				day: '2-digit',
				month: 'short',
				year: 'numeric'
			});
		return { display, iso, tzid, allDay: true };
	}
	const iso = `${y}-${mo}-${d}T${hh}:${mm}:${ss}${utc ? 'Z' : ''}`;
	let display: string;
	if (utc) {
		const date = new Date(iso);
		display = isNaN(date.getTime())
			? iso
			: date.toLocaleString(undefined, {
				weekday: 'short',
				day: '2-digit',
				month: 'short',
				year: 'numeric',
				hour: '2-digit',
				minute: '2-digit'
			});
	} else {
		display = `${y}-${mo}-${d} ${hh}:${mm}${tzid ? ` (${tzid})` : ''}`;
	}
	return { display, iso, tzid, allDay: false };
}

export function parseIcs(text: string): CalendarEvent[] {
	const lines = unfoldLines(text);
	const events: CalendarEvent[] = [];
	let method: string | undefined;
	let inEvent: CalendarEvent | null = null;

	for (const raw of lines) {
		if (!raw) continue;
		const prop = parseLine(raw);
		if (!prop) continue;
		const { name, params, value } = prop;

		if (name === 'BEGIN' && value === 'VEVENT') {
			inEvent = { attendees: [], attendeeNames: {} };
			continue;
		}
		if (name === 'END' && value === 'VEVENT' && inEvent) {
			if (method) inEvent.method = method;
			inEvent.rawIcs = text;
			events.push(inEvent);
			inEvent = null;
			continue;
		}
		if (!inEvent) {
			if (name === 'METHOD') method = value.toUpperCase();
			continue;
		}

		switch (name) {
			case 'SUMMARY':
				inEvent.summary = unescapeText(value);
				break;
			case 'LOCATION':
				inEvent.location = unescapeText(value);
				break;
			case 'DESCRIPTION':
				inEvent.description = unescapeText(value);
				break;
			case 'ORGANIZER':
				inEvent.organizer = parseAddress(value);
				if (params['CN']) inEvent.organizerName = unescapeText(params['CN']);
				break;
			case 'ATTENDEE': {
				const a = parseAddress(value);
				if (a) {
					inEvent.attendees.push(a);
					if (params['CN']) {
						(inEvent.attendeeNames ??= {})[a] = unescapeText(params['CN']);
					}
				}
				break;
			}
			case 'DTSTART':
				inEvent.start = parseIcsDate(value, params['TZID']);
				break;
			case 'DTEND':
				inEvent.end = parseIcsDate(value, params['TZID']);
				break;
			case 'DTSTAMP':
				inEvent.dtstamp = value;
				break;
			case 'SEQUENCE': {
				const n = Number(value);
				if (Number.isFinite(n)) inEvent.sequence = n;
				break;
			}
			case 'UID':
				inEvent.uid = value;
				break;
		}
	}

	return events;
}

export function methodBadgeLabel(method: string | undefined): string {
	switch ((method ?? '').toUpperCase()) {
		case 'REQUEST':
			return 'Invitation';
		case 'REPLY':
			return 'Reply';
		case 'CANCEL':
			return 'Canceled';
		case 'COUNTER':
			return 'Counter';
		case 'PUBLISH':
			return 'Event';
		default:
			return method ? method.charAt(0).toUpperCase() + method.slice(1).toLowerCase() : 'Event';
	}
}
