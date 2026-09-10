import { describe, it, expect } from 'vitest';
import { summarizeEncryption } from './encSummary';

describe('summarizeEncryption', () => {
	it('keeps the encrypted promise when there are no recipients yet', () => {
		const s = summarizeEncryption([]);
		expect(s.tone).toBe('ok');
		expect(s.label).toBe('Encrypted');
	});

	it('reports encrypted when every recipient resolves to a key', () => {
		expect(summarizeEncryption(['internal', 'encrypted', 'internal']).tone).toBe('ok');
		expect(summarizeEncryption(['encrypted']).label).toBe('Encrypted');
	});

	it('reports not encrypted when no recipient has a key', () => {
		const s = summarizeEncryption(['cleartext', 'cleartext']);
		expect(s.tone).toBe('none');
		expect(s.label).toBe('Not encrypted');
		expect(s.title).toContain('No recipient has an encryption key');
	});

	it('uses singular copy for a lone keyless recipient', () => {
		expect(summarizeEncryption(['cleartext']).title).toContain('The recipient has no encryption key');
	});

	it('reports partial encryption for a mixed recipient set', () => {
		const s = summarizeEncryption(['internal', 'cleartext', 'encrypted']);
		expect(s.tone).toBe('partial');
		expect(s.label).toBe('Partly encrypted');
		expect(s.title).toContain('1 of 3 recipients has no encryption key');
	});

	it('pluralises the partial count', () => {
		expect(summarizeEncryption(['internal', 'cleartext', 'cleartext']).title).toContain(
			'2 of 3 recipients have no encryption key'
		);
	});

	it('stays pending while any lookup is unresolved', () => {
		expect(summarizeEncryption(['cleartext', 'checking']).tone).toBe('pending');
		expect(summarizeEncryption(['internal', null]).tone).toBe('pending');
	});
});
