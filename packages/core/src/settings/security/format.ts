import Monitor from '@lucide/svelte/icons/monitor';
import Smartphone from '@lucide/svelte/icons/smartphone';
import Globe from '@lucide/svelte/icons/globe';
import { i18n } from '$core/i18n/locale.svelte';
import { m } from '$paraglide/messages.js';
import type { SessionClient } from '$core/api/types';

export function fmtDate(iso: string | undefined | null): string {
	if (!iso) return '';
	const d = new Date(iso);
	return Number.isNaN(d.getTime())
		? ''
		: d.toLocaleDateString(i18n.tag, { year: 'numeric', month: 'short', day: 'numeric' });
}

export const sessionClientIcon: Record<SessionClient, typeof Monitor> = {
	web: Globe,
	mobile: Smartphone,
	desktop: Monitor
};

const sessionClientNames: Record<SessionClient, () => string> = {
	web: () => m.settings_security_client_web(),
	mobile: () => m.settings_security_client_mobile(),
	desktop: () => m.settings_security_client_desktop()
};

export function sessionClientName(client: SessionClient): string | undefined {
	return sessionClientNames[client]?.();
}
