import { describe, it, expect } from 'vitest';
import { deriveTrust, type TrustFacts } from './trust';
import { officialFacts, signedFromAddress } from './officialSender';
import { isOfficialAddress } from '$lib/directory/official';
import { OFFICIAL_FINGERPRINTS } from '$lib/directory/official';

const NOW = Date.UTC(2026, 7, 30, 12, 0, 0);
const OFFICIAL_ADDRESS = 'no-reply@thel.email';
const OFFICIAL_FP = [...OFFICIAL_FINGERPRINTS][0];

function signedMime(from = OFFICIAL_ADDRESS): string {
	return [
		`From: Thelemail <${from}>`,
		'To: <anna@thelemail.com>',
		'Subject: Your mailbox is ready',
		'Content-Type: text/plain; charset=utf-8',
		'',
		'hello'
	].join('\r\n');
}

function official(overrides: Partial<TrustFacts> = {}): TrustFacts {
	const senderAddress = overrides.senderAddress ?? OFFICIAL_ADDRESS;
	const channel = overrides.channel ?? 'internal';
	const signature = 'signature' in overrides
		? overrides.signature
		: ({ state: 'valid', keyFingerprintHex: OFFICIAL_FP } as const);
	const mime = (overrides as { signedMime?: string }).signedMime ?? signedMime();
	return {
		channel,
		senderAddress,
		e2e: true,
		signature,
		nowMillis: NOW,
		...overrides,
		official: officialFacts({ senderAddress, channel, signature, signedMime: mime })
	};
}

describe('official sender policy', () => {
	it('matches the allowlisted address case-insensitively', () => {
		expect(isOfficialAddress(OFFICIAL_ADDRESS)).toBe(true);
		expect(isOfficialAddress('No-Reply@Thel.Email')).toBe(true);
	});

	it('does not match lookalike addresses', () => {
		expect(isOfficialAddress('no-reply@thel.email.evil.com')).toBe(false);
		expect(isOfficialAddress('no-reply@thelemail.com')).toBe(false);
		expect(isOfficialAddress('no.reply@thel.email')).toBe(false);
	});
});

describe('signedFromAddress', () => {
	it('reads the From address out of the signed headers', () => {
		expect(signedFromAddress(signedMime())).toBe(OFFICIAL_ADDRESS);
	});

	it('returns undefined when there are no headers', () => {
		expect(signedFromAddress('just a body')).toBeUndefined();
		expect(signedFromAddress(undefined)).toBeUndefined();
	});
});

describe('official trust tier', () => {
	it('marks a correctly signed internal message official', () => {
		const t = deriveTrust(official());
		expect(t.tier).toBe('official');
		expect(t.label).toBe('Official');
		expect(t.headline).toBe('Sent by Thelemail');
	});

	it('fails an official address with no signature', () => {
		const t = deriveTrust(official({ signature: undefined }));
		expect(t.tier).toBe('failed');
		expect(t.label).toBe('Not from Thelemail');
	});

	it('fails an official address signed by another key', () => {
		const t = deriveTrust(official({ signature: { state: 'valid', keyFingerprintHex: 'cc'.repeat(32) } }));
		expect(t.tier).toBe('failed');
		expect(t.label).toBe('Not from Thelemail');
	});

	it('fails when the signed From does not match the displayed sender', () => {
		const senderAddress = OFFICIAL_ADDRESS;
		const signature = { state: 'valid', keyFingerprintHex: OFFICIAL_FP } as const;
		const t = deriveTrust({
			channel: 'internal',
			senderAddress,
			e2e: true,
			signature,
			nowMillis: NOW,
			official: officialFacts({
				senderAddress,
				channel: 'internal',
				signature,
				signedMime: signedMime('someone-else@thel.email')
			})
		});
		expect(t.tier).toBe('failed');
		expect(t.label).toBe('Not from Thelemail');
	});

	it('fails when an official address arrives over ordinary mail', () => {
		const t = deriveTrust(official({ channel: 'inbound_external' }));
		expect(t.tier).toBe('failed');
		expect(t.label).toBe('Not from Thelemail');
	});

	it('stays official when the directory is unreachable', () => {
		const t = deriveTrust(official({ directory: null }));
		expect(t.tier).toBe('official');
	});

	it('leaves ordinary senders untouched even when signed by the official key', () => {
		const senderAddress = 'ada@thelemail.com';
		const signature = { state: 'valid', keyFingerprintHex: OFFICIAL_FP } as const;
		const t = deriveTrust({
			channel: 'internal',
			senderAddress,
			e2e: true,
			signature,
			nowMillis: NOW,
			official: officialFacts({ senderAddress, channel: 'internal', signature })
		});
		expect(t.tier).not.toBe('official');
		expect(t.label).not.toBe('Not from Thelemail');
	});
});
