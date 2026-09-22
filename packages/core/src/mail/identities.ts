import type { AccountAddress } from '$core/api/addresses';
import type { SendIdentity } from './data';
import { initialsFor } from './initials';

export interface FromChoice {
	identity: SendIdentity | null;
	unavailable: string | null;
}

export function sendIdentityOf(a: AccountAddress, fullName: string | null): SendIdentity {
	const label = a.shared ? (a.name ?? a.email) : (a.name ?? fullName ?? a.email);
	return {
		name: label,
		email: a.email,
		init: initialsFor(label, a.email),
		bg: a.shared ? 'var(--info-700)' : 'var(--pine-700)',
		fg: '#EEF2EA',
		org: '',
		kind: a.shared ? 'Alias' : a.isPrimary ? 'Default' : 'Identity',
		addressId: a.id,
		aliasId: a.sharedAliasId ?? undefined
	};
}

export function chooseFrom(options: SendIdentity[], wanted: string | null): FromChoice {
	const want = wanted?.trim() ?? '';
	const key = want.toLowerCase();
	const hit = key ? options.find((o) => o.email.toLowerCase() === key) : undefined;
	const fallback = options.find((o) => o.kind !== 'Alias') ?? options[0] ?? null;
	return { identity: hit ?? fallback, unavailable: key && !hit ? want : null };
}
