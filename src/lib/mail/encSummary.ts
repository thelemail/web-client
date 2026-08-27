import type { RecipientEncStatus } from './RecipientField.svelte';

export type EncryptionTone = 'ok' | 'pending' | 'partial' | 'none';

export interface EncryptionSummary {
	tone: EncryptionTone;
	label: string;
	title: string;
}

export function summarizeEncryption(statuses: RecipientEncStatus[]): EncryptionSummary {
	const total = statuses.length;
	if (total === 0) {
		return {
			tone: 'ok',
			label: 'Encrypted',
			title:
				'Mail to Thelemail accounts and to anyone with a published key is end-to-end encrypted.'
		};
	}
	if (statuses.some((s) => s === 'checking' || s == null)) {
		return {
			tone: 'pending',
			label: 'Checking keys',
			title: 'Looking up encryption keys for the recipients.'
		};
	}
	const cleartext = statuses.filter((s) => s === 'cleartext').length;
	if (cleartext === 0) {
		return {
			tone: 'ok',
			label: 'Encrypted',
			title: 'End-to-end encrypted for every recipient.'
		};
	}
	if (cleartext === total) {
		return {
			tone: 'none',
			label: 'Not encrypted',
			title:
				total === 1
					? 'The recipient has no encryption key, so this message is sent unencrypted.'
					: 'No recipient has an encryption key, so this message is sent unencrypted.'
		};
	}
	return {
		tone: 'partial',
		label: 'Partly encrypted',
		title: `${cleartext} of ${total} recipients ${cleartext === 1 ? 'has' : 'have'} no encryption key, so their copy is sent unencrypted.`
	};
}
