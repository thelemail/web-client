import { getMessage } from '$core/api/messages';
import { loadMessageBody } from '$core/mail/bodySource';
import { decryptPreview } from '$core/mail/decrypt';
import { auth } from '$core/stores/auth.svelte';
import { applyCalendarEvents, type AppliedChange } from '../replies';
import { calendarStore } from '../store.svelte';

export async function applyFromMessageId(messageId: string): Promise<AppliedChange[]> {
	const accountId = auth.accountId;
	if (!accountId || !calendarStore.loaded) return [];
	const detail = await getMessage(messageId);
	const preview = await decryptPreview(accountId, detail.encryptedPreview);
	const method = preview.flags?.calendar;
	if (typeof method !== 'string' || !['REPLY', 'CANCEL', 'REQUEST'].includes(method)) return [];
	const { render } = await loadMessageBody(accountId, messageId, { stripTracking: true });
	return applyCalendarEvents(render.calendarEvents, messageId);
}
