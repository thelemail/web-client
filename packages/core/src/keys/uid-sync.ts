import { keystore } from '$core/keystore/keystore-client';
import { updateKeys } from '$core/api/me';
import { listMyAddresses } from '$core/api/addresses';
import { ApiCallError } from '$core/api/types';
import { accountKeys } from '$core/stores/accountKeys.svelte';

interface Pending {
	sig: string;
	run: Promise<void>;
}

const inFlight = new Map<string, Pending>();
const keyLocks = new Map<string, Promise<unknown>>();

export function withKeyLock<T>(accountId: string, fn: () => Promise<T>): Promise<T> {
	const previous = keyLocks.get(accountId) ?? Promise.resolve();
	const run = previous.catch(() => {}).then(fn);
	const tail = run.catch(() => {});
	keyLocks.set(accountId, tail);
	void tail.finally(() => {
		if (keyLocks.get(accountId) === tail) keyLocks.delete(accountId);
	});
	return run;
}

function signature(emails?: string[]): string {
	if (!emails) return '*';
	return Array.from(new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean)))
		.sort()
		.join(',');
}

export function syncAddressUids(accountId: string, emails?: string[]): Promise<void> {
	const sig = signature(emails);
	const pending = inFlight.get(accountId);
	if (pending?.sig === sig) return pending.run;
	const entry: Pending = {
		sig,
		run: withKeyLock(accountId, () => doSync(accountId, emails)).finally(() => {
			if (inFlight.get(accountId) === entry) inFlight.delete(accountId);
		})
	};
	inFlight.set(accountId, entry);
	return entry.run;
}

function isStaleKey(err: unknown): boolean {
	return err instanceof ApiCallError && err.envelope?.error?.code === 'account_key_stale';
}

async function doSync(accountId: string, emails?: string[]): Promise<void> {
	try {
		let addressEmails = emails;
		if (!addressEmails) {
			const { addresses } = await listMyAddresses(accountId);
			addressEmails = [...addresses].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)).map((a) => a.email);
		}
		for (let attempt = 0; attempt < 2; attempt++) {
			const reformatted = await keystore.reformatKeyWithUids({ accountId, emails: addressEmails });
			if (!reformatted.ok) {
				if (reformatted.code !== 'locked' && reformatted.code !== 'no_key_password') {
					console.warn('uid-sync: reformat failed', reformatted.code);
				}
				return;
			}
			if (reformatted.unchanged) return;
			try {
				await updateKeys(
					{
						publicKeyArmored: reformatted.publicKeyArmored,
						encryptedPrivateKey: reformatted.encryptedPrivateKey
					},
					accountId
				);
			} catch (err) {
				if (attempt === 0 && isStaleKey(err)) {
					await accountKeys.load(accountId);
					continue;
				}
				throw err;
			}
			await keystore.commitReformattedKey({
				accountId,
				encryptedPrivateKey: reformatted.encryptedPrivateKey
			});
			return;
		}
	} catch (err) {
		console.warn('uid-sync: failed', err);
	}
}
