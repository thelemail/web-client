import { describe, it, expect } from 'vitest';
import { MAX_REPLY_TO, replyToParties, trustedReplyTo, type MessagePreview } from './preview';

function preview(overrides: Partial<MessagePreview> = {}): MessagePreview {
	return {
		v: 1,
		subject: 'hi',
		sender: { display: 'News', address: 'news@mail.example.com' },
		recipients: [],
		snippet: '',
		display_date: '',
		reply_to: [{ display: 'The List', address: 'list@lists.example.org', offsite: true }],
		...overrides
	};
}

const inbound = { source: 'inbound_external', direction: 'received' };

describe('replyToParties', () => {
	it('keeps display, address and the offsite flag', () => {
		expect(
			replyToParties([
				{ display: 'The List', address: ' list@lists.example.org ', offsite: true },
				{ address: 'help@example.com', offsite: 'yes' }
			])
		).toEqual([
			{ display: 'The List', address: 'list@lists.example.org', offsite: true },
			{ display: '', address: 'help@example.com' }
		]);
	});

	it('drops blank entries and non-arrays', () => {
		expect(replyToParties([{ address: ' ' }, null, 'x'])).toBeUndefined();
		expect(replyToParties({ address: 'a@example.com' })).toBeUndefined();
	});

	it('ignores the whole list above the cap', () => {
		const many = Array.from({ length: MAX_REPLY_TO + 1 }, (_, i) => ({ address: `a${i}@example.com` }));
		expect(replyToParties(many)).toBeUndefined();
		expect(replyToParties(many.slice(0, MAX_REPLY_TO))).toHaveLength(MAX_REPLY_TO);
	});
});

describe('trustedReplyTo', () => {
	it('honours Reply-To on received external mail', () => {
		expect(trustedReplyTo(preview(), inbound, false)).toEqual([
			{ display: 'The List', address: 'list@lists.example.org', offsite: true }
		]);
	});

	it('ignores internal mail, whose preview the sender wrote', () => {
		expect(trustedReplyTo(preview(), { source: 'internal', direction: 'received' }, false)).toBeUndefined();
	});

	it('ignores sent mail', () => {
		expect(trustedReplyTo(preview(), { source: 'inbound_external', direction: 'sent' }, false)).toBeUndefined();
	});

	it('ignores a forged sender', () => {
		expect(trustedReplyTo(preview(), inbound, true)).toBeUndefined();
	});

	it('ignores imported mail', () => {
		expect(trustedReplyTo(preview({ flags: { imported: true } }), inbound, false)).toBeUndefined();
	});

	it('is empty without Reply-To', () => {
		expect(trustedReplyTo(preview({ reply_to: undefined }), inbound, false)).toBeUndefined();
	});
});
