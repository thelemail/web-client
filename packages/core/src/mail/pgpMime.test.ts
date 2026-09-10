import { describe, it, expect } from 'vitest';
import { isPgpEncryptedMime, extractPgpArmor } from './pgpMime';

const armor =
	'-----BEGIN PGP MESSAGE-----\r\n\r\nwcBMA0FakePayload\r\n=ab12\r\n-----END PGP MESSAGE-----';

function wrap(payload: string, cte = '7bit'): string {
	const b = 'test-boundary';
	return (
		'MIME-Version: 1.0\r\n' +
		`Content-Type: multipart/encrypted; protocol="application/pgp-encrypted"; boundary="${b}"\r\n` +
		'\r\n' +
		`--${b}\r\n` +
		'Content-Type: application/pgp-encrypted\r\n' +
		'Content-Transfer-Encoding: 7bit\r\n' +
		'\r\n' +
		'Version: 1\r\n' +
		`--${b}\r\n` +
		'Content-Type: application/octet-stream; name="encrypted.asc"\r\n' +
		`Content-Transfer-Encoding: ${cte}\r\n` +
		'\r\n' +
		`${payload}\r\n` +
		`--${b}--\r\n`
	);
}

describe('pgpMime', () => {
	it('detects and extracts a 7bit RFC 3156 payload', () => {
		const mime = wrap(armor);
		expect(isPgpEncryptedMime(mime)).toBe(true);
		expect(extractPgpArmor(mime)).toBe(armor);
	});

	it('extracts a base64 transfer-encoded payload', () => {
		const mime = wrap(btoa(armor), 'base64');
		expect(isPgpEncryptedMime(mime)).toBe(true);
		expect(extractPgpArmor(mime)).toBe(armor);
	});

	it('ignores plain multipart mail', () => {
		const mime =
			'Content-Type: multipart/alternative; boundary="alt"\r\n\r\n--alt\r\nContent-Type: text/plain\r\n\r\n-----BEGIN PGP MESSAGE----- quoted\r\n--alt--\r\n';
		expect(isPgpEncryptedMime(mime)).toBe(false);
		expect(extractPgpArmor(mime)).toBe(null);
	});

	it('returns null when the payload carries no armor', () => {
		expect(extractPgpArmor(wrap('nothing here'))).toBe(null);
	});
});
