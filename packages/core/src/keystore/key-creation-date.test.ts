// @vitest-environment node
import * as openpgp from 'openpgp';
import { describe, expect, it } from 'vitest';

import { KEY_CREATION_BACKDATE_MS, keyCreationDate } from './opaque-params';
import {
	recordServerDate,
	resetServerClock,
	serverClockOffsetMs,
	serverNow
} from '$core/api/serverclock';

describe('keyCreationDate', () => {
	it('sits a fixed margin behind the local clock', () => {
		const now = Date.UTC(2026, 8, 8, 12, 0, 0);
		expect(keyCreationDate(now).getTime()).toBe(now - KEY_CREATION_BACKDATE_MS);
	});

	it('gives the server room to encrypt to the key even on a clock minutes fast', () => {
		expect(KEY_CREATION_BACKDATE_MS).toBeGreaterThanOrEqual(60_000);
	});
});

describe('generated account keys', () => {
	it(
		'stamp the primary key and its encryption subkey in the past',
		async () => {
			const before = Date.now();
			const { publicKey } = await openpgp.generateKey({
				type: 'curve25519',
				userIDs: [{ email: 'anna@thelemail.test' }],
				date: keyCreationDate(),
				format: 'object'
			});

			expect(publicKey.getCreationTime().getTime()).toBeLessThan(before);

			const subkeys = publicKey.getSubkeys();
			expect(subkeys.length).toBeGreaterThan(0);
			for (const sub of subkeys) {
				expect(sub.getCreationTime().getTime()).toBeLessThan(before);
			}
		},
		60_000
	);

	it(
		'would otherwise carry the local clock, which is what the server could not encrypt to',
		async () => {
			const { publicKey } = await openpgp.generateKey({
				type: 'curve25519',
				userIDs: [{ email: 'anna@thelemail.test' }],
				format: 'object'
			});
			const drift = publicKey.getCreationTime().getTime() - keyCreationDate().getTime();
			expect(drift).toBeGreaterThanOrEqual(KEY_CREATION_BACKDATE_MS - 1000);
		},
		60_000
	);
});

describe('server clock', () => {
	it('learns the offset from a Date header and survives a wildly wrong device clock', () => {
		resetServerClock();
		const serverMs = Date.now() + 3 * 60 * 60 * 1000;
		recordServerDate(new Date(serverMs).toUTCString());

		expect(serverClockOffsetMs()).toBeGreaterThan(2 * 60 * 60 * 1000);
		expect(Math.abs(serverNow() - serverMs)).toBeLessThan(2000);
		resetServerClock();
	});

	it('ignores a missing or unparseable Date rather than corrupting the offset', () => {
		resetServerClock();
		recordServerDate(null);
		recordServerDate('not a date');
		expect(serverClockOffsetMs()).toBe(0);
	});

	it(
		'stamps a key in the server past even when the device clock runs hours fast',
		async () => {
			resetServerClock();
			const deviceAheadMs = 3 * 60 * 60 * 1000;
			const serverMs = Date.now() - deviceAheadMs;
			recordServerDate(new Date(serverMs).toUTCString());

			const { publicKey } = await openpgp.generateKey({
				type: 'curve25519',
				userIDs: [{ email: 'anna@thelemail.test' }],
				date: keyCreationDate(serverNow()),
				format: 'object'
			});

			expect(publicKey.getCreationTime().getTime()).toBeLessThan(serverMs);
			for (const sub of publicKey.getSubkeys()) {
				expect(sub.getCreationTime().getTime()).toBeLessThan(serverMs);
			}
			resetServerClock();
		},
		60_000
	);
});
