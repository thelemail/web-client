import { goto } from '$app/navigation';
import { b64ToHex, b64ToText } from './keys/encode';
import { handoffUrl } from './fork';
import { currentProduct, productTarget } from './products';
import { calendarKeys } from './stores/calendarKeys.svelte';

export async function openCalendar(accountId: string, slot: number): Promise<void> {
	const path = `/u/${slot}/calendar`;
	const target = productTarget('calendar');
	if (!target || currentProduct === 'calendar' || target.origin === window.location.origin) {
		await goto(path);
		return;
	}
	await calendarKeys.ready(accountId);
	const grants = calendarKeys.grants.map((k) => ({
		aliasId: k.calendarId,
		addressId: k.calendarId,
		email: '',
		name: 'Calendar',
		keyVersion: k.keyVersion,
		aliasKeyFingerprintHex: b64ToHex(k.calendarKeyFingerprint),
		wrappedPrivateKeyArmored: b64ToText(k.wrappedPrivateKey),
		isCurrent: k.isCurrent
	}));
	const url = await handoffUrl(accountId, 'calendar', grants, path);
	window.location.assign(url);
}
