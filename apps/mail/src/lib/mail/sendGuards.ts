import type { RecipientEncStatus } from './RecipientField.svelte';
import type { ComposingSettings } from '$lib/stores/accountSettings.svelte';

export type SendGuard = 'unencrypted' | 'external' | 'subject';

export interface SendGuardInput {
	settings: ComposingSettings;
	statuses: RecipientEncStatus[];
	subject?: string;
}

const REASONS: Record<SendGuard, string> = {
	unencrypted: 'A recipient has no published key, so their copy leaves in the clear.',
	external: 'At least one recipient is not a Thelemail account.',
	subject: 'The subject line is empty.'
};

const TITLES: Record<SendGuard, string> = {
	unencrypted: 'Send unencrypted?',
	external: 'Send outside Thelemail?',
	subject: 'Send without a subject?'
};

const CONFIRM_LABELS: Record<SendGuard, string> = {
	unencrypted: 'Send unencrypted',
	external: 'Send',
	subject: 'Send anyway'
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
	return guards.length ? TITLES[guards[0]] : '';
}

export function sendGuardConfirmLabel(guards: SendGuard[]): string {
	return guards.length ? CONFIRM_LABELS[guards[0]] : 'Send';
}

export function sendGuardReasons(guards: SendGuard[]): string[] {
	return guards.map((g) => REASONS[g]);
}
