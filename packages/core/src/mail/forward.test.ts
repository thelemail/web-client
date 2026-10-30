import { describe, expect, it } from 'vitest';
import type { Message } from './data';
import { addressedIdentity, forwardFallbackText, forwardQuote, forwardSource } from './forward';

function msg(overrides: Partial<Message> = {}): Message {
	return {
		id: 'm1',
		direction: 'received',
		from: 'Mira Costa',
		fromAddr: 'mira@atelier.example',
		to: 'alex@studio.example',
		subj: 'A few notes before Friday',
		prev: 'The revised plan is attached.',
		body: [],
		epoch: Date.UTC(2026, 9, 8, 14, 20),
		...overrides
	} as Message;
}

describe('forwardSource', () => {
	it('lists to and cc recipients separately', () => {
		const src = forwardSource(
			msg({
				recipients: [
					{ display: 'Alex Morgan', address: 'alex@studio.example', kind: 'to' },
					{ display: 'riley@venue.example', address: 'riley@venue.example', kind: 'cc' }
				]
			}),
			'Alex Morgan'
		);
		expect(src.toLine).toBe('Alex Morgan <alex@studio.example>');
		expect(src.ccLine).toBe('riley@venue.example');
		expect(src.subject).toBe('A few notes before Friday');
	});

	it('falls back to the plain to line without recipients', () => {
		expect(forwardSource(msg(), 'Alex').toLine).toBe('alex@studio.example');
	});

	it('names the account holder as sender of their own mail', () => {
		const src = forwardSource(msg({ direction: 'sent', from: 'me' }), 'Alex Morgan');
		expect(src.fromDisplay).toBe('Alex Morgan');
	});
});

describe('forwardQuote', () => {
	it('carries the original headers and body', () => {
		const q = forwardQuote(msg(), 'Alex', '<p>Hi Alex</p>', 'Hi Alex');
		expect(q.text).toContain('Forwarded message');
		expect(q.text).toContain('mira@atelier.example');
		expect(q.text).toContain('Hi Alex');
		expect(q.html).toContain('<p>Hi Alex</p>');
	});
});

describe('forwardFallbackText', () => {
	it('prefers the loaded body over the preview', () => {
		expect(forwardFallbackText(msg({ body: ['One', 'Two'] }))).toBe('One\n\nTwo');
		expect(forwardFallbackText(msg())).toBe('The revised plan is attached.');
		expect(forwardFallbackText(null)).toBe('');
	});
});

describe('addressedIdentity', () => {
	const own = new Map([
		['team@studio.example', 'team@studio.example'],
		['alex@studio.example', 'alex@studio.example']
	]);
	const lookup = (a: string) => own.get(a.toLowerCase()) ?? null;

	it('picks the address the message was delivered to first', () => {
		const m = msg({
			deliveredTo: 'team@studio.example',
			recipients: [{ display: '', address: 'alex@studio.example', kind: 'to' }]
		});
		expect(addressedIdentity(m, lookup)).toBe('team@studio.example');
	});

	it('falls back to an own recipient address', () => {
		const m = msg({ recipients: [{ display: '', address: 'alex@studio.example', kind: 'to' }] });
		expect(addressedIdentity(m, lookup)).toBe('alex@studio.example');
	});

	it('returns null when none of the addresses are ours', () => {
		expect(addressedIdentity(msg({ to: 'x@y.example' }), lookup)).toBeNull();
	});
});
