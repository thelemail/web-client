import type { RecipientEncStatus } from './RecipientField.svelte';
import type { ComposingSettings } from '$core/stores/accountSettings.svelte';
import { m } from '$paraglide/messages.js';

export type SendGuard = 'unencrypted' | 'external' | 'subject';

export interface SendGuardInput {
	settings: ComposingSettings;
	statuses: RecipientEncStatus[];
	subject?: string;
}

const REASONS: Record<SendGuard, () => string> = {
	unencrypted: () => m.send_guard_reason_unencrypted(),
	external: () => m.send_guard_reason_external(),
	subject: () => m.send_guard_reason_subject()
};

const TITLES: Record<SendGuard, () => string> = {
	unencrypted: () => m.send_guard_title_unencrypted(),
	external: () => m.send_guard_title_external(),
	subject: () => m.send_guard_title_subject()
};

const CONFIRM_LABELS: Record<SendGuard, () => string> = {
	unencrypted: () => m.send_guard_confirm_unencrypted(),
	external: () => m.common_send(),
	subject: () => m.send_guard_confirm_subject()
};

export function pendingSendGuards({ settings, statuses, subject }: SendGuardInput): SendGuard[] {
	const guards: SendGuard[] = [];
	if (settings.confirmUnencrypted && statuses.some((s) => s === 'cleartext')) {
		guards.push('unencrypted');
	}
	if (settings.confirmExternal && statuses.some((s) => s === 'cleartext' || s === 'encrypted')) {
		guards.push('external');
	}
	if (settings.confirmSubject && subject !== undefined && subject.trim() === '') {
		guards.push('subject');
	}
	return guards;
}

export function sendGuardTitle(guards: SendGuard[]): string {
	return guards.length ? TITLES[guards[0]]() : '';
}

export function sendGuardConfirmLabel(guards: SendGuard[]): string {
	return guards.length ? CONFIRM_LABELS[guards[0]]() : m.common_send();
}

export function sendGuardReasons(guards: SendGuard[]): string[] {
	return guards.map((g) => REASONS[g]());
}
