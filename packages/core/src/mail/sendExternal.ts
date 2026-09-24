import { auth } from '$core/stores/auth.svelte';
import { m } from '$paraglide/messages.js';
import { platform } from '$platform';
import { submitExternal, uploadIntentMessage } from '$core/api/submission';
import { lookupExternalKey } from '$core/api/externalKeys';
import { keystore } from '$core/keystore/keystore-client';
import {
	ApiCallError,
	type AttachmentDescriptor,
	type EncryptedCopy,
	type IntentMailbox,
	type RecipientParty,
	type SendEnvelope,
	type SubmissionIntent,
	type SubmitMessageResponse,
	type SubmitOutcome
} from '$core/api/types';
import { SendError, sendErrorFromApi, senderKey, releaseDate, buildEnvelope, buildPreview } from './send';
import {
	buildMIME,
	composeBodyEntityBytes,
	composeMime,
	messageIdDomain,
	readMimeAttachments,
	type BuildMIMEArgs
} from './mime';
import type { ReplyParty } from './replyRecipients';
import type { Attachment as ComposeAttachment } from './attachmentUpload';
import { packBodyForSend } from './signaturePack';

export interface ExternalComposeInput {
	to: ReplyParty[];
	cc?: ReplyParty[];
	bcc?: ReplyParty[];
	replyTo?: ReplyParty;
	subject: string;
	body: string;
	bodyHtml?: string;
	inReplyToHeader?: string;
	references?: string[];
	calendar?: { method: 'REQUEST' | 'REPLY' | 'CANCEL'; ics: string };
	attachments?: ComposeAttachment[];
	fromEmail?: string;
	fromName?: string;
	fromAliasId?: string;
	sentMessageId?: string;
	scheduledAt?: string;
}

export interface KeyedRecipient {
	address: string;
	display: string;
	armoredKey: string;
	fingerprint: string;
}

export interface EncryptionGroup {
	addresses: string[];
	armoredKeys: string[];
}

const MAX_DISPLAY_NAME = 255;

function lower(address: string): string {
	return address.trim().toLowerCase();
}

function party(p: ReplyParty): RecipientParty {
	const name = p.display.trim().slice(0, MAX_DISPLAY_NAME);
	if (!name || name.toLowerCase() === lower(p.address)) return { address: p.address };
	return { name, address: p.address };
}

function parties(list: ReplyParty[] | undefined): RecipientParty[] | undefined {
	return list && list.length ? list.map(party) : undefined;
}

export function encryptionGroups(
	keyed: KeyedRecipient[],
	visible: ReplyParty[]
): EncryptionGroup[] {
	const disclosed = new Set(visible.map((r) => lower(r.address)));
	const shared: EncryptionGroup = { addresses: [], armoredKeys: [] };
	const blind: EncryptionGroup[] = [];
	const seen = new Set<string>();
	for (const k of keyed) {
		const addr = lower(k.address);
		if (seen.has(addr)) continue;
		seen.add(addr);
		if (disclosed.has(addr)) {
			shared.addresses.push(k.address);
			shared.armoredKeys.push(k.armoredKey);
			continue;
		}
		blind.push({ addresses: [k.address], armoredKeys: [k.armoredKey] });
	}
	return shared.addresses.length > 0 ? [shared, ...blind] : blind;
}

async function resolveExternalKeys(
	recipients: ReplyParty[]
): Promise<{ keyed: KeyedRecipient[]; keyless: ReplyParty[] }> {
	const keyed: KeyedRecipient[] = [];
	const keyless: ReplyParty[] = [];
	const seen = new Set<string>();
	for (const r of recipients) {
		if (seen.has(lower(r.address))) continue;
		seen.add(lower(r.address));
		try {
			const trust = await lookupExternalKey(r.address);
			if (trust.status === 'changed') {
				throw new SendError(
					'external_key_change',
					m.send_error_external_key_changed({ address: r.address }),
					undefined,
					{ kind: 'external-key-change', address: r.address, currentFingerprint: trust.fingerprint }
				);
			}
			if (!trust.armoredKey) {
				keyless.push(r);
				continue;
			}
			keyed.push({
				address: r.address,
				display: r.display,
				armoredKey: trust.armoredKey,
				fingerprint: trust.fingerprint
			});
		} catch (e) {
			if (e instanceof SendError) throw e;
			if (e instanceof ApiCallError && e.status === 404) {
				keyless.push(r);
				continue;
			}
			throw sendErrorFromApi(e, m.send_error_key_lookup_failed());
		}
	}
	return { keyed, keyless };
}

export async function sendExternalMessage(
	input: ExternalComposeInput
): Promise<SubmitMessageResponse> {
	const allRecipients = [...input.to, ...(input.cc ?? []), ...(input.bcc ?? [])];
	if (allRecipients.length === 0) {
		throw new SendError('no_account', m.send_error_no_recipients());
	}
	if (!auth.accountId) {
		throw new SendError('no_account', m.send_error_not_signed_in());
	}
	const accountId = auth.accountId;

	const fromAddress = input.fromEmail ?? auth.email ?? 'me@thelemail.local';
	const fromName = input.fromName ?? auth.fullName ?? fromAddress;
	const sender = input.sentMessageId ? null : await senderKey(accountId, input.fromAliasId);

	const { keyed, keyless } = await resolveExternalKeys(allRecipients);

	const now = releaseDate(input.scheduledAt);
	const packed = await packBodyForSend(input.bodyHtml);

	const mimeArgs: BuildMIMEArgs = {
		fromName,
		fromAddress,
		to: input.to,
		cc: input.cc,
		replyTo: input.replyTo,
		subject: input.subject,
		body: input.body,
		bodyHtml: packed.bodyHtml,
		date: now,
		messageId: crypto.randomUUID(),
		inReplyTo: input.inReplyToHeader,
		references: input.references,
		calendar: input.calendar,
		relatedParts: packed.relatedParts,
		attachments: readMimeAttachments(input.attachments ?? [])
	};

	let encryptedCopies: EncryptedCopy[] | undefined;
	if (keyed.length > 0) {
		const bodyEntity = await composeBodyEntityBytes(mimeArgs);
		const groups = encryptionGroups(keyed, [...input.to, ...(input.cc ?? [])]);
		const copies: EncryptedCopy[] = [];
		for (const group of groups) {
			const enc = await keystore.encryptToKeys({
				accountId,
				recipientPublicKeysArmored: group.armoredKeys,
				plaintext: bodyEntity
			});
			if (!enc.ok) {
				throw new SendError(
					enc.code === 'locked' ? 'locked' : 'encrypt',
					`encryptToKeys: ${enc.code}`
				);
			}
			copies.push({ encryptedBody: enc.armored, addresses: group.addresses });
		}
		encryptedCopies = copies;
	}

	let sealed: SendEnvelope | undefined;
	if (sender) {
		const previewBytes = new TextEncoder().encode(
			JSON.stringify(buildPreview({ ...input, fromEmail: fromAddress, fromName }, true, now))
		);
		const senderAtts: AttachmentDescriptor[] = [];
		const atts = input.attachments ?? [];
		for (let i = 0; i < atts.length; i++) {
			if (!atts[i].senderDescriptor) {
				throw new SendError('encrypt', m.send_error_attachments_uploading());
			}
			senderAtts.push({ ...atts[i].senderDescriptor!, ordinal: i });
		}
		const sentMime = buildMIME({
			fromName,
			fromAddress,
			to: input.to,
			cc: input.cc,
			bcc: input.bcc,
			replyTo: input.replyTo,
			subject: input.subject,
			body: input.body,
			bodyHtml: packed.bodyHtml,
			date: now,
			messageId: crypto.randomUUID(),
			messageIdDomain: messageIdDomain(fromAddress),
			inReplyTo: input.inReplyToHeader,
			references: input.references,
			calendar: input.calendar,
			relatedParts: packed.relatedParts
		});
		sealed = await buildEnvelope(accountId, previewBytes, sentMime, sender, senderAtts);
	}

	let outcome: SubmitOutcome;
	try {
		outcome = await submitExternal({
			idempotencyKey: crypto.randomUUID(),
			schemaVersion: 1,
			from: input.fromEmail,
			to: input.to.map(party),
			cc: parties(input.cc),
			bcc: parties(input.bcc),
			replyTo: input.replyTo?.address,
			subject: input.subject,
			inReplyToHeader: input.inReplyToHeader,
			references: input.references && input.references.length ? input.references : undefined,
			sent: sealed,
			sentMessageId: input.sentMessageId,
			encryptedCopies,
			scheduledAt: input.scheduledAt
		});
	} catch (e) {
		throw sendErrorFromApi(e, m.send_error_external_failed());
	}
	if (outcome.kind === 'accepted') return outcome.response;
	if (keyless.length === 0) {
		throw new SendError('server_error', m.send_error_external_failed());
	}
	return deliverCleartext(outcome.intent, mimeArgs);
}

function replyParties(list: IntentMailbox[] | undefined): ReplyParty[] {
	return (list ?? []).map((p) => ({ display: p.name ?? '', address: p.address }));
}

async function deliverCleartext(
	intent: SubmissionIntent,
	args: BuildMIMEArgs
): Promise<SubmitMessageResponse> {
	const message = await composeMime(
		{ ...args, to: replyParties(intent.to), cc: replyParties(intent.cc), bcc: undefined },
		{
			date: intent.date,
			messageId: intent.messageIdHeader,
			fromName: intent.from.name ?? '',
			fromAddress: intent.from.address,
			inReplyTo: intent.inReplyTo,
			references: intent.references,
			replyTo: intent.replyTo
		}
	);
	if (message.size > intent.maxMessageBytes) {
		throw new SendError('rejected', m.send_error_message_too_large());
	}
	try {
		return await uploadIntentMessage(intent, message);
	} catch (e) {
		throw sendErrorFromApi(e, m.send_error_external_failed());
	}
}
