import { keystore } from '$lib/keystore/keystore-client';
import { updateKeys } from '$lib/api/me';
import { listMyAddresses } from '$lib/api/addresses';

const inFlight = new Map<string, Promise<void>>();

export function syncAddressUids(accountId: string, emails?: string[]): Promise<void> {
	const running = inFlight.get(accountId);
	if (running) return running;
	const run = doSync(accountId, emails).finally(() => {
		if (inFlight.get(accountId) === run) inFlight.delete(accountId);
	});
	inFlight.set(accountId, run);
	return run;
}

async function doSync(accountId: string, emails?: string[]): Promise<void> {
	try {
		let addressEmails = emails;
		if (!addressEmails) {
			const { addresses } = await listMyAddresses();
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

		await updateKeys({
			publicKeyArmored: reformatted.publicKeyArmored,
			encryptedPrivateKey: reformatted.encryptedPrivateKey
		});
		await keystore.commitReformattedKey({
			accountId,
			encryptedPrivateKey: reformatted.encryptedPrivateKey
		});
	} catch (err) {
		console.warn('uid-sync: failed', err);
	}
}
