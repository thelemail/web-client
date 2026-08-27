import { sendInternalMessage, SendError, sendErrorFromApi, type ComposeInput } from './send';
import { sendExternalMessage } from './sendExternal';
import type { ReplyParty } from './replyRecipients';
import type { Attachment as ComposeAttachment } from './attachmentUpload';
import { lookupAccount } from '$lib/api/accounts';
import { ApiCallError } from '$lib/api/types';

const CLASSIFY_TTL_MS = 2 * 60 * 1000;

export const MIXED_SCHEDULE_MESSAGE =
	'Scheduling needs every recipient to be on Thelemail, or every recipient to be outside it. This message has both, so send it now or split it into two messages.';

const classifyCache = new Map<string, { cls: 'internal' | 'external'; at: number }>();

export async function classifyAddress(address: string): Promise<'internal' | 'external'> {
	const email = address.trim().toLowerCase();
	const hit = classifyCache.get(email);
	if (hit && Date.now() - hit.at < CLASSIFY_TTL_MS) return hit.cls;
	let cls: 'internal' | 'external';
	try {
		await lookupAccount(email);
		cls = 'internal';
	} catch (e) {
		if (e instanceof ApiCallError && e.status === 404) {
			cls = 'external';
		} else {
			throw sendErrorFromApi(e, 'Could not look up the recipient');
		}
	}
	classifyCache.set(email, { cls, at: Date.now() });
	return cls;
}

export interface DispatchRecipient {
	display?: string;
	address: string;
}

export interface DispatchInput {
	to: DispatchRecipient[];
	cc?: DispatchRecipient[];
	bcc?: DispatchRecipient[];
	replyTo?: DispatchRecipient;
	subject: string;
	body: string;
	bodyHtml?: string;
	inReplyToMessageId?: string;
	inReplyToHeader?: string;
	references?: string[];
	calendar?: { method: 'REQUEST' | 'REPLY' | 'CANCEL'; ics: string };
	attachments?: ComposeAttachment[];
	fromEmail?: string;
	fromName?: string;
	scheduledAt?: string;
}

export interface DispatchOptions {
	acceptKeyChange?: boolean;
}

function party(r: DispatchRecipient): ReplyParty {
	return { display: r.display ?? '', address: r.address };
}

function parties(list: DispatchRecipient[] | undefined): ReplyParty[] | undefined {
	return list && list.length ? list.map(party) : undefined;
}

function toComposeInput(input: DispatchInput): ComposeInput {
	return {
		to: input.to.map(party),
		cc: parties(input.cc),
		bcc: parties(input.bcc),
		replyTo: input.replyTo ? party(input.replyTo) : undefined,
		subject: input.subject,
		body: input.body,
		bodyHtml: input.bodyHtml,
		inReplyToMessageId: input.inReplyToMessageId,
		inReplyToHeader: input.inReplyToHeader,
		references: input.references,
		calendar: input.calendar,
		attachments: input.attachments,
		fromEmail: input.fromEmail,
		fromName: input.fromName,
		scheduledAt: input.scheduledAt
	};
}

async function sendMixed(
	input: DispatchInput,
	opts: DispatchOptions,
	classes: Map<string, 'internal' | 'external'>
): Promise<void> {
	if (input.scheduledAt) {
		throw new SendError('schedule_unsupported', MIXED_SCHEDULE_MESSAGE);
	}
	const internalAddresses = new Set(
		[...classes].filter(([, cls]) => cls === 'internal').map(([addr]) => addr)
	);
	const sent = await sendInternalMessage(toComposeInput(input), {
		acceptKeyChange: opts.acceptKeyChange,
		deliverOnly: internalAddresses
	});
	const externalOnly = (list: DispatchRecipient[] | undefined) =>
		(list ?? [])
			.filter((r) => classes.get(r.address.trim().toLowerCase()) === 'external')
			.map(party);
	const externalCc = externalOnly(input.cc);
	const externalBcc = externalOnly(input.bcc);
	await sendExternalMessage({
		to: externalOnly(input.to),
		cc: externalCc.length ? externalCc : undefined,
		bcc: externalBcc.length ? externalBcc : undefined,
		replyTo: input.replyTo ? party(input.replyTo) : undefined,
		subject: input.subject,
		body: input.body,
		bodyHtml: input.bodyHtml,
		inReplyToHeader: input.inReplyToHeader,
		references: input.references,
		calendar: input.calendar,
		attachments: input.attachments,
		fromEmail: input.fromEmail,
		fromName: input.fromName,
		scheduledAt: input.scheduledAt,
		sentMessageId: sent.messageId
	});
}

export async function dispatchSend(
	input: DispatchInput,
	opts: DispatchOptions = {}
): Promise<void> {
	const all = [...input.to, ...(input.cc ?? []), ...(input.bcc ?? [])];
	if (all.length === 0) {
		throw new SendError('no_account', 'At least one recipient is required.');
	}

	const unique = [...new Set(all.map((r) => r.address.trim().toLowerCase()))];
	const results = await Promise.all(unique.map((a) => classifyAddress(a)));
	const classes = new Map(unique.map((a, i) => [a, results[i]]));
	const hasInternal = results.includes('internal');
	const hasExternal = results.includes('external');

	if (hasInternal && hasExternal) {
		await sendMixed(input, opts, classes);
		return;
	}

	if (hasExternal) {
		await sendExternalMessage({
			to: input.to.map(party),
			cc: parties(input.cc),
			bcc: parties(input.bcc),
			replyTo: input.replyTo ? party(input.replyTo) : undefined,
			subject: input.subject,
			body: input.body,
			bodyHtml: input.bodyHtml,
			inReplyToHeader: input.inReplyToHeader,
			references: input.references,
			calendar: input.calendar,
			attachments: input.attachments,
			fromEmail: input.fromEmail,
			fromName: input.fromName,
			scheduledAt: input.scheduledAt
		});
		return;
	}

	await sendInternalMessage(toComposeInput(input), { acceptKeyChange: opts.acceptKeyChange });
}
