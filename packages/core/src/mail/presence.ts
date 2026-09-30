import { m } from '$paraglide/messages.js';
import type { ReplyPresenceEntry } from '$core/api/types';
import { addresses } from '$core/stores/addresses.svelte';

export function replyingLine(entries: readonly ReplyPresenceEntry[]): string | null {
	if (entries.length === 0) return null;
	const names = entries
		.map((e) => addresses.aliasMember(e.aliasId, e.accountId))
		.map((member) => (member ? member.fullName.trim() || member.email : null))
		.filter((name): name is string => !!name);
	if (names.length === 0) return m.mail_reply_presence_someone();
	if (names.length === 1) return m.mail_reply_presence_one({ name: names[0] });
	return m.mail_reply_presence_many({ names: names.join(', ') });
}
