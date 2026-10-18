import { describe, expect, it } from 'vitest';
import { formatDay, formatFingerprintHex, formatKeyId, formatVerifiedAt, keyIdHex } from './format';

const V6 = '3baeafb735520147cc533435e4ad6f0a2aaa9f6bf023001d8bdab3610e1ba600';
const V4 = '2f1ee47e2e754f6ef9a9b0ce3779c6bf6eb12be8';

describe('fingerprint formatting', () => {
	it('groups a v6 fingerprint into sixteen blocks around a middle dot', () => {
		expect(formatFingerprintHex(V6)).toBe(
			'3BAE AFB7 3552 0147 CC53 3435 E4AD 6F0A · 2AAA 9F6B F023 001D 8BDA B361 0E1B A600'
		);
	});

	it('uses the leading half of a v6 fingerprint and the trailing half of a v4 one as the key id', () => {
		expect(keyIdHex(V6)).toBe('3baeafb735520147');
		expect(keyIdHex(V4)).toBe('3779c6bf6eb12be8');
		expect(formatKeyId(V6)).toBe('3BAE AFB7 3552 0147');
		expect(formatKeyId(V4.toUpperCase())).toBe('3779 C6BF 6EB1 2BE8');
	});

	it('formats days without a raw timestamp', () => {
		const t = Date.UTC(2026, 9, 3, 23, 59);
		expect(formatDay(t)).toBe('03 Oct 2026');
		expect(formatVerifiedAt(t, 4)).toBe('03 Oct 2026 · v4');
	});
});
