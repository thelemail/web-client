// @vitest-environment node
import { describe, expect, it } from 'vitest';
import raw from './fixtures/calendar-signatures-v1-vectors.json?raw';
import { utf8 } from './canonical';
import type { CalendarAuthority } from './calendar';
import { calendarAuthority, CALENDAR_DOMAIN, CALENDAR_TYPE, verifyCalendarFreeBusy, verifyCalendarGrant, verifyCalendarMessage } from './calendar';
import { b64decode, sha256 } from './encoding';
import { ProductKeysError } from './errors';
import { DOMAIN } from './manifests';
import { parsePublicKey, validateProfile, verifyTranscript } from './pgp';
import { PROFILE } from './profiles';

const DIGEST = '25314c59dffc7870efb4cf36ba9eaccfcd981a7760b22a24e20ddd97aecc5e2f';

interface AuthorityVector {
	name: string;
	accountId: string;
	authorityKey: string;
	authorityEpoch: number;
	delegation: string;
	delegationSignature: string;
	signingKey: string;
	error?: string;
}

interface StatementVector {
	name: string;
	authority: string;
	type: string;
	record: string;
	signature: string;
	error?: string;
}

const file = JSON.parse(raw) as { version: number; mailKey: string; authorities: AuthorityVector[]; statements: StatementVector[] };

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

async function code(p: Promise<unknown>): Promise<string> {
	try {
		await p;
		return '';
	} catch (err) {
		if (err instanceof ProductKeysError) return err.code;
		throw err;
	}
}

function authority(v: AuthorityVector): Promise<CalendarAuthority> {
	return calendarAuthority(v.accountId, b64decode(v.authorityKey), v.authorityEpoch, utf8(v.delegation), b64decode(v.delegationSignature), b64decode(v.signingKey));
}

function verify(a: CalendarAuthority, v: StatementVector): Promise<unknown> {
	const record = utf8(v.record);
	const sig = b64decode(v.signature);
	switch (v.type) {
		case CALENDAR_TYPE.freeBusy:
			return verifyCalendarFreeBusy(a, record, sig);
		case CALENDAR_TYPE.grant:
			return verifyCalendarGrant(a, record, sig);
		default:
			return verifyCalendarMessage(a, record, sig);
	}
}

describe('calendar signature vectors shared with platform', () => {
	it('is the pinned file', async () => {
		expect(hex(await sha256(utf8(raw)))).toBe(DIGEST);
		expect(file.version).toBe(1);
	});

	for (const v of file.authorities) {
		it(`authority: ${v.name}`, async () => {
			expect(await code(authority(v))).toBe(v.error ?? '');
		});
	}

	for (const v of file.statements) {
		it(`statement: ${v.name}`, async () => {
			const a = await authority(file.authorities.find((x) => x.name === v.authority) as AuthorityVector);
			expect(await code(verify(a, v))).toBe(v.error ?? '');
		});
	}

	it('never verifies a calendar signature as a delegation, manifest or account statement', async () => {
		const cal = await parsePublicKey(b64decode(file.authorities[0].signingKey));
		for (const v of file.statements.filter((s) => !s.error)) {
			for (const domain of [DOMAIN.delegation, DOMAIN.identityManifest, DOMAIN.dataManifest, 'thelemail/account-head/v2', ...Object.values(CALENDAR_DOMAIN).filter((d) => d !== CALENDAR_DOMAIN[v.type as keyof typeof CALENDAR_DOMAIN])]) {
				expect(await code(verifyTranscript(domain, utf8(v.record), b64decode(v.signature), cal))).toBe('signature');
			}
		}
		expect(await code(validateProfile(PROFILE.accountAuthority, cal))).toBe('profile');
	});
});
