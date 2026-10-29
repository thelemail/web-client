import { describe, expect, it } from 'vitest';
import type { AccountAddress } from '$core/api/addresses';
import { chooseFrom, fromNeedsChoice, sendIdentityOf } from './identities';

function address(over: Partial<AccountAddress> = {}): AccountAddress {
	return {
		id: 'a1',
		accountId: 'me',
		email: 'ada@acme.test',
		localPart: 'ada',
		isPrimary: false,
		createdAt: '2026-09-01T00:00:00Z',
		updatedAt: '2026-09-01T00:00:00Z',
		...over
	};
}

const primary = sendIdentityOf(address({ id: 'p', email: 'ada@thel.email', isPrimary: true }), 'Ada');
const work = sendIdentityOf(address({ id: 'w', email: 'ada@acme.test' }), 'Ada');
const sales = sendIdentityOf(
	address({ id: 's', email: 'sales@acme.test', name: 'Sales', shared: true, sharedAliasId: 'al1' }),
	'Ada'
);

describe('sendIdentityOf', () => {
	it('names shared addresses by their own name and personal ones by yours', () => {
		expect(sales).toMatchObject({ name: 'Sales', kind: 'Alias', addressId: 's', aliasId: 'al1' });
		expect(work).toMatchObject({ name: 'Ada', kind: 'Identity', addressId: 'w' });
		expect(primary.kind).toBe('Default');
		expect(sendIdentityOf(address({ name: 'Ada at Acme' }), 'Ada').name).toBe('Ada at Acme');
		expect(sendIdentityOf(address(), null).name).toBe('ada@acme.test');
	});
});

describe('chooseFrom', () => {
	it('keeps the chosen address while it can still send', () => {
		const choice = chooseFrom([primary, work], 'ADA@acme.test ');
		expect(choice.identity).toBe(work);
		expect(choice.unavailable).toBeNull();
	});

	it('falls back to the primary when the chosen address cannot send', () => {
		const choice = chooseFrom([primary, sales], 'ada@acme.test');
		expect(choice.identity).toBe(primary);
		expect(choice.unavailable).toBe('ada@acme.test');
	});

	it('prefers a personal address over a shared one when falling back', () => {
		expect(chooseFrom([sales, work], 'gone@acme.test').identity).toBe(work);
	});

	it('falls back to the primary even when another platform address is listed first', () => {
		const twin = sendIdentityOf(address({ id: 't', email: 'ada@temail.org' }), 'Ada');
		expect(chooseFrom([twin, primary], null).identity).toBe(primary);
	});

	it('falls back quietly when nothing was chosen', () => {
		const choice = chooseFrom([primary, work], null);
		expect(choice.identity).toBe(primary);
		expect(choice.unavailable).toBeNull();
		expect(chooseFrom([sales], '').identity).toBe(sales);
	});

	it('has no sender when no address can send', () => {
		expect(chooseFrom([], 'ada@acme.test')).toEqual({
			identity: null,
			unavailable: 'ada@acme.test'
		});
	});
});

describe('fromNeedsChoice', () => {
	const options = [sendIdentityOf(address({ email: 'work@a.test', isPrimary: true }), 'Me')];

	it('asks for a choice when a restored draft was written from an address that can no longer send', () => {
		const choice = chooseFrom(options, 'old@a.test');
		expect(choice.identity?.email).toBe('work@a.test');
		expect(fromNeedsChoice(choice, 'old@a.test', 'old@a.test')).toBe(true);
	});

	it('stops asking once the user picks another address', () => {
		expect(fromNeedsChoice(chooseFrom(options, 'work@a.test'), 'old@a.test', 'work@a.test')).toBe(false);
	});

	it('does not ask when the saved address is still available or nothing was restored', () => {
		expect(fromNeedsChoice(chooseFrom(options, 'work@a.test'), 'work@a.test', 'work@a.test')).toBe(false);
		expect(fromNeedsChoice(chooseFrom(options, 'old@a.test'), null, 'old@a.test')).toBe(false);
	});
});
