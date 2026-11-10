import { dispatchSend } from '$core/mail/sendDispatch';
import type { OutboxMail } from '../outbox';

export async function sendCalendarMail(mail: OutboxMail): Promise<void> {
	await dispatchSend({
		to: mail.to,
		subject: mail.subject,
		body: mail.body,
		calendar: { method: mail.method, ics: mail.ics },
		fromEmail: mail.fromEmail,
		fromName: mail.fromName,
		fromAliasId: mail.fromAliasId,
		inReplyToMessageId: mail.inReplyToMessageId,
		inReplyToHeader: mail.inReplyToHeader,
		references: mail.references
	});
}
