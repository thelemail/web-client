import { describe, expect, it } from 'vitest';

import type { ForwardDelivery, ReadDelegation } from '$core/api/readDelegations';
import { deliveryLabel, deliveryTone, summarise } from './deliveryStatus';

function delivery(status: ForwardDelivery['status']): ForwardDelivery {
	return { id: crypto.randomUUID(), source: 'inbound', status, attempts: 1, createdAt: '2026-09-17T12:00:00Z' };
}

describe('forward delivery status', () => {
	it('explains every unsupported case in plain words', () => {
		expect(deliveryLabel('not_forwarded_encrypted')).toMatch(/encrypted/);
		expect(deliveryLabel('not_forwarded_missing_copy')).toMatch(/copy/);
		expect(deliveryTone('loop_suppressed')).toBe('warn');
		expect(deliveryTone('queued')).toBe('neutral');
	});

	it('counts recent outcomes', () => {
		const d = {
			recent: [delivery('failed'), delivery('delivered'), delivery('delivered'), delivery('not_forwarded_spam'), delivery('queued')]
		} as ReadDelegation;
		const s = summarise(d);
		expect(s).toMatchObject({ delivered: 2, failed: 1, skipped: 1 });
		expect(s.latest?.status).toBe('failed');
	});
});
