import { keystore } from '$core/keystore/keystore-client';
import { updateKeys } from '$core/api/me';
import { listMyAddresses } from '$core/api/addresses';

interface Pending {
	sig: string;
	run: Promise<void>;
}

const inFlight = new Map<string, Pending>();

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
	const start = pending ? pending.run.catch(() => {}) : Promise.resolve();
	const entry: Pending = {
		sig,
		run: start
			.then(() => doSync(accountId, emails))
			.finally(() => {
				if (inFlight.get(accountId) === entry) inFlight.delete(accountId);
			})
	};
	inFlight.set(accountId, entry);
	return entry.run;
}

async function doSync(accountId: string, emails?: string[]): Promise<void> {
	try {
		let addressEmails = emails;
		if (!addressEmails) {
			const { addresses } = await listMyAddresses(accountId);
			addressEmails = addresses.map((a) => a.email);
		}
		const reformatted = await keystore.reformatKeyWithUids({ accountId, emails: addressEmails });
		if (!reformatted.ok) {
			if (reformatted.code !== 'locked' && reformatted.code !== 'no_key_password') {
				console.warn('uid-sync: reformat failed', reformatted.code);
			}
			return;
		}
		if (reformatted.unchanged) return;

		await updateKeys(
			{
				publicKeyArmored: reformatted.publicKeyArmored,
				encryptedPrivateKey: reformatted.encryptedPrivateKey
			},
			accountId
		);
		await keystore.commitReformattedKey({
			accountId,
			encryptedPrivateKey: reformatted.encryptedPrivateKey
		});
	} catch (err) {
		console.warn('uid-sync: failed', err);
	}
}
