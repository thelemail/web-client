import { describe, it, expect, vi } from 'vitest';

vi.mock('$core/stores/addresses.svelte', () => ({
	addresses: {
		aliasMember: (aliasId: string, accountId: string) => {
			if (aliasId !== 'alias-1') return null;
			if (accountId === 'anna') return { accountId, email: 'anna@acme.test', fullName: 'Anna Berg' };
			if (accountId === 'ben') return { accountId, email: 'ben@acme.test', fullName: ' ' };
			return null;
		}
	}
}));

import { sentByFrom, sentByLabel, sentByName } from './sentBy';

describe('sentBy', () => {
	it('reads the sender only when both ids are present', () => {
		expect(sentByFrom({ sentViaAliasId: 'alias-1', sentByAccountId: 'anna' })).toEqual({ aliasId: 'alias-1', accountId: 'anna' });
		expect(sentByFrom({ sentViaAliasId: 'alias-1' })).toBeUndefined();
		expect(sentByFrom({})).toBeUndefined();
	});

	it('names a teammate, falling back to their address', () => {
		expect(sentByName({ aliasId: 'alias-1', accountId: 'anna' }, 'me')).toBe('Anna Berg');
		expect(sentByName({ aliasId: 'alias-1', accountId: 'ben' }, 'me')).toBe('ben@acme.test');
		expect(sentByName({ aliasId: 'alias-1', accountId: 'me' }, 'me')).toBeNull();
	});

	it('labels the viewer, a teammate and someone who has left', () => {
		expect(sentByLabel({ aliasId: 'alias-1', accountId: 'me' }, 'me')).toBe('Sent by you');
		expect(sentByLabel({ aliasId: 'alias-1', accountId: 'anna' }, 'me')).toBe('Sent by Anna Berg');
		expect(sentByLabel({ aliasId: 'alias-1', accountId: 'gone' }, 'me')).toBe('Sent by a former member');
		expect(sentByLabel(undefined, 'me')).toBeNull();
	});
});
