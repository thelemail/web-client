import {
	faArrowRightArrowLeft,
	faDisplay,
	faGlobe,
	faMobile
} from '@fortawesome/pro-regular-svg-icons';
import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
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

export const sessionClientIcon: Record<SessionClient, IconDefinition> = {
	web: faGlobe,
	mobile: faMobile,
	desktop: faDisplay,
	migrator: faArrowRightArrowLeft
};

const sessionClientNames: Record<SessionClient, () => string> = {
	web: () => m.settings_security_client_web(),
	mobile: () => m.settings_security_client_mobile(),
	desktop: () => m.settings_security_client_desktop(),
	migrator: () => m.settings_security_client_migrator()
};

export function sessionClientName(client: SessionClient): string | undefined {
	return sessionClientNames[client]?.();
}
