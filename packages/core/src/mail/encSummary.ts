import type { RecipientEncStatus } from './RecipientField.svelte';
import { m } from '$paraglide/messages.js';

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
			label: m.send_enc_encrypted(),
			title: m.send_enc_title_default()
		};
	}
	if (statuses.some((s) => s === 'checking' || s == null)) {
		return {
			tone: 'pending',
			label: m.send_enc_checking(),
			title: m.send_enc_title_checking()
		};
	}
	const cleartext = statuses.filter((s) => s === 'cleartext').length;
	if (cleartext === 0) {
		return {
			tone: 'ok',
			label: m.send_enc_encrypted(),
			title: m.send_enc_title_all()
		};
	}
	if (cleartext === total) {
		return {
			tone: 'none',
			label: m.send_enc_none(),
			title: total === 1 ? m.send_enc_title_none_one() : m.send_enc_title_none_many()
		};
	}
	return {
		tone: 'partial',
		label: m.send_enc_partial(),
		title: m.send_enc_title_partial({ count: cleartext, total })
	};
}
