import type { UnsubscribeLinks } from './preview';

export type UnsubscribeMethod =
	| { kind: 'one-click'; url: string; tag: string }
	| { kind: 'mailto'; to: string; subject: string; body: string }
	| { kind: 'page'; url: string };

export interface MailtoTarget {
	to: string;
	subject: string;
	body: string;
}

const ADDRESS = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;
const DEFAULT_SUBJECT = 'unsubscribe';
const MAX_FIELD = 998;

function decode(part: string): string | null {
	try {
		return decodeURIComponent(part);
	} catch {
		return null;
	}
}

export function parseMailto(uri: string): MailtoTarget | null {
	if (!/^mailto:/i.test(uri)) return null;
	const rest = uri.slice('mailto:'.length);
	const q = rest.indexOf('?');
	const path = q < 0 ? rest : rest.slice(0, q);
	const query = q < 0 ? '' : rest.slice(q + 1);

	const recipients: string[] = [];
	for (const raw of path.split(',')) {
		const addr = decode(raw.trim());
		if (addr) recipients.push(addr.trim());
	}
	let subject = '';
	let body = '';
	for (const field of query.split('&')) {
		if (!field) continue;
		const eq = field.indexOf('=');
		const name = (eq < 0 ? field : field.slice(0, eq)).toLowerCase();
		const value = decode(eq < 0 ? '' : field.slice(eq + 1));
		if (value === null) return null;
		if (name === 'to') {
			for (const addr of value.split(',')) if (addr.trim()) recipients.push(addr.trim());
		} else if (name === 'subject') {
			subject = value;
		} else if (name === 'body') {
			body = value;
		}
	}

	const to = recipients.find((r) => ADDRESS.test(r));
	if (!to) return null;
	subject = subject.replace(/[\r\n]+/g, ' ').trim().slice(0, MAX_FIELD) || DEFAULT_SUBJECT;
	body = body.replace(/\r\n?/g, '\n').slice(0, 10_000) || DEFAULT_SUBJECT;
	return { to, subject, body };
}

export function unsubscribeMethod(links: UnsubscribeLinks | undefined): UnsubscribeMethod | null {
	if (!links) return null;
	if (links.oneClick) return { kind: 'one-click', url: links.oneClick.url, tag: links.oneClick.tag };
	if (links.mailto) {
		const target = parseMailto(links.mailto);
		if (target) return { kind: 'mailto', ...target };
	}
	if (links.page) return { kind: 'page', url: links.page };
	return null;
}
