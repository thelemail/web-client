import { m } from '$paraglide/messages.js';
import { i18n } from '$core/i18n/locale.svelte';
import { buildRecoveryKitPdf } from './kit-pdf';

export const RECOVERY_KIT_FILENAME = 'thelemail-recovery-kit.pdf';

export function recoveryKitBlob(words: string[], email: string): Blob {
	const created = new Intl.DateTimeFormat(i18n.tag, { dateStyle: 'long' }).format(new Date());
	const bytes = buildRecoveryKitPdf({
		words,
		email,
		created,
		text: {
			eyebrow: m.recovery_kit_eyebrow(),
			title: m.recovery_kit_title(),
			accountLabel: m.recovery_kit_account(),
			createdLabel: m.recovery_kit_created(),
			phraseHeading: m.recovery_kit_phrase_heading(),
			sections: [
				{ heading: m.recovery_kit_what_heading(), body: m.recovery_kit_what_body() },
				{ heading: m.recovery_kit_keep_heading(), body: m.recovery_kit_keep_body() },
				{ heading: m.recovery_kit_new_heading(), body: m.recovery_kit_new_body() }
			],
			footer: m.recovery_kit_footer()
		}
	});
	return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}
