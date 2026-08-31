import { auth } from '$lib/stores/auth.svelte';
import { platform } from '$platform';
import { bytesToB64 } from '$lib/crypto';
import { issueStagingUrls, submitExternal } from '$lib/api/submission';
import { lookupExternalKey } from '$lib/api/externalKeys';
import { keystore } from '$lib/keystore/keystore-client';
import {
	ApiCallError,
	type AttachmentDescriptor,
	type EncryptedCopy,
	type RecipientParty,
	type SendEnvelope,
	type StagedAttachment,
	type StagingSlotRequest,
	type SubmitMessageResponse
} from '$lib/api/types';
import {
	SendError,
	sendErrorFromApi,
	senderKey,
	releaseDate,
	buildMIME,
	buildBodyEntity,
	buildEnvelope,
	buildPreview,
	messageIdDomain,
	type MIMEAttachment
} from './send';
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

async function stageCleartext(attachments: ComposeAttachment[]): Promise<StagedAttachment[]> {
	if (attachments.length === 0) return [];
	const slots: StagingSlotRequest[] = attachments.map((a, i) => ({
		slotId: crypto.randomUUID(),
		ordinal: i,
		plaintextSizeBytes: a.file.size
	}));
	const grants = await issueStagingUrls({ slots });
	const grantBySlot = new Map(grants.slots.map((g) => [g.slotId, g]));

	const staged: StagedAttachment[] = [];
	for (let i = 0; i < attachments.length; i++) {
		const a = attachments[i];
		const grant = grantBySlot.get(slots[i].slotId);
		if (!grant) throw new SendError('network', 'staging grant missing');
		const bytes = new Uint8Array(await a.file.arrayBuffer());
		const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
		const blob = new Blob([
			bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
		]);
		const resp = await platform.blobPut(grant.putUrl, blob);
		if (!resp.ok) {
			throw new SendError('network', `staging PUT ${resp.status}: ${resp.statusText}`);
		}
		staged.push({
			stagingSlotId: grant.slotId,
			filename: a.file.name,
			contentType: a.file.type || 'application/octet-stream',
			disposition: a.disposition,
			contentId: a.contentId,
			plaintextSizeBytes: a.file.size,
			plaintextSha256: bytesToB64(digest),
			ordinal: i
		});
	}
	return staged;
}

async function readMimeAttachments(attachments: ComposeAttachment[]): Promise<MIMEAttachment[]> {
	const out: MIMEAttachment[] = [];
	for (const a of attachments) {
		out.push({
			filename: a.file.name,
			contentType: a.file.type || 'application/octet-stream',
			bytes: new Uint8Array(await a.file.arrayBuffer()),
			disposition: a.disposition,
			contentId: a.contentId
		});
	}
	return out;
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
					`The encryption key for ${r.address} has changed.`,
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
			throw sendErrorFromApi(e, 'Key lookup failed');
		}
	}
	return { keyed, keyless };
}

export async function sendExternalMessage(
	input: ExternalComposeInput
): Promise<SubmitMessageResponse> {
	const allRecipients = [...input.to, ...(input.cc ?? []), ...(input.bcc ?? [])];
	if (allRecipients.length === 0) {
		throw new SendError('no_account', 'At least one recipient is required.');
	}
	if (!auth.accountId) {
		throw new SendError('no_account', 'Not signed in.');
	}
	const accountId = auth.accountId;

	const fromAddress = input.fromEmail ?? auth.email ?? 'me@thelemail.local';
	const fromName = input.fromName ?? auth.fullName ?? fromAddress;
	const sender = input.sentMessageId ? null : await senderKey(accountId, input.fromAliasId);

	const { keyed, keyless } = await resolveExternalKeys(allRecipients);

	const now = releaseDate(input.scheduledAt);
	const packed = await packBodyForSend(input.bodyHtml);

	let encryptedCopies: EncryptedCopy[] | undefined;
	if (keyed.length > 0) {
		const attachments = await readMimeAttachments(input.attachments ?? []);
		const bodyEntity = buildBodyEntity({
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
			attachments
		});
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

	let stagedAttachments: StagedAttachment[] | undefined;
	let textBody: string | undefined;
	let htmlBody: string | undefined;
	if (keyless.length > 0) {
		const staged = await stageCleartext(input.attachments ?? []);
		stagedAttachments = staged.length > 0 ? staged : undefined;
		textBody = input.body;
		htmlBody = packed.bodyHtml;
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
				throw new SendError('encrypt', 'Some attachments are still uploading.');
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

	try {
		return await submitExternal({
			idempotencyKey: crypto.randomUUID(),
			schemaVersion: 1,
			from: input.fromEmail,
			to: input.to.map(party),
			cc: parties(input.cc),
			bcc: parties(input.bcc),
			replyTo: input.replyTo?.address,
			subject: input.subject,
			textBody,
			htmlBody,
			inReplyToHeader: input.inReplyToHeader,
			references: input.references && input.references.length ? input.references : undefined,
			calendar: input.calendar,
			sent: sealed,
			sentMessageId: input.sentMessageId,
			encryptedCopies,
			stagedAttachments,
			scheduledAt: input.scheduledAt
		});
	} catch (e) {
		throw sendErrorFromApi(e, 'External send failed');
	}
}
