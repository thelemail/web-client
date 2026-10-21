import { describe, expect, it } from 'vitest';
import { attestedMismatch, senderFields } from './attestedSender';

describe('attestedMismatch', () => {
	it('ignores case and surrounding space', () => {
		expect(attestedMismatch('Ana@Acme.test', ' ana@acme.test ')).toBeNull();
	});

	it('compares composed and decomposed forms as one address', () => {
		expect(attestedMismatch('josé@acme.test', 'josé@acme.test')).toBeNull();
	});

	it('returns the attested address when the preview names another', () => {
		expect(attestedMismatch('mallory@acme.test', 'ana@acme.test')).toBe('mallory@acme.test');
	});

	it('treats an empty preview address as a mismatch', () => {
		expect(attestedMismatch('mallory@acme.test', '')).toBe('mallory@acme.test');
	});

	it('has nothing to compare without an attestation', () => {
		expect(attestedMismatch(undefined, 'ana@acme.test')).toBeNull();
		expect(attestedMismatch(null, 'ana@acme.test')).toBeNull();
	});
});

describe('senderFields', () => {
	it('keeps the display name when the sender is attested', () => {
		expect(senderFields({ display: 'Ana Lima', address: 'ana@acme.test' }, 'ana@acme.test')).toMatchObject({
			from: 'Ana Lima',
			fromAddr: 'ana@acme.test',
			init: 'AL'
		});
	});

	it('shows only the attested address on a mismatch', () => {
		const fields = senderFields({ display: 'Ana Lima', address: 'ana@acme.test' }, 'mallory@acme.test');
		expect(fields).toMatchObject({ from: 'mallory@acme.test', fromAddr: 'mallory@acme.test', senderMismatch: true });
		expect(fields.init).toBe('MA');
	});
});
