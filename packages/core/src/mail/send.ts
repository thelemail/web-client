import * as openpgp from 'openpgp';
import { auth } from '$core/stores/auth.svelte';
import { keystore } from '$core/keystore/keystore-client';
import { bytesToB64, hexToBytes } from '$core/crypto';
import { sendInternal } from '$core/api/messages';
import { lookupDirectory } from '$core/directory/lookup';
import { ApiCallError, type ErrorCode } from '$core/api/types';
import type {
	AttachmentDescriptor,
	ForwardCopy,
	InternalSendRequest,
	InternalSendResponse,
	ReadDelegate,
	SendEnvelope
} from '$core/api/types';
import type { Attachment as ComposeAttachment } from './attachmentUpload';
import { verifyDirectoryLookup, DirectoryVerificationError } from '$core/directory/verify';
import { verifyReadDelegate } from '$core/directory/read-delegation';
import type { DirectoryVerificationCode } from '$core/directory/verify';
import { DIRECTORY_SIGNING_KEY_FINGERPRINT_HEX } from '$core/directory/signing-key';
import { formatFingerprintHex, formatVerifiedAt } from '$core/directory/format';
import type { MessagePreview, MessagePreviewRecipient } from './preview';
import type { ReplyParty } from './replyRecipients';
import { packBodyForSend } from './signaturePack';
import { snippetSource } from './quote';
import {
	buildMIME,
	composeMimeBytes,
	messageIdDomain,
	readMimeAttachments,
	type BuildMIMEArgs
} from './mime';
import { canonicalRecipient } from './recipientAddress';
import { m } from '$paraglide/messages.js';

export interface ComposeInput {
	to: ReplyParty[];
	cc?: ReplyParty[];
	bcc?: ReplyParty[];
	replyTo?: ReplyParty;
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
	fromAliasId?: string;
	scheduledAt?: string;
}

export type SendErrorCode =
	| 'locked'
	| 'no_account'
	| 'recipient_unknown'
	| 'recipient_key_invalid'
	| 'directory_verification_failed'
	| 'tofu'
	| 'external_key_change'
	| 'encrypt'
	| 'rate_limited'
	| 'schedule_unsupported'
	| 'malware_blocked'
	| 'rejected'
	| 'server_error'
	| 'network'
	| 'unknown';

export type SendErrorPayload =
	| {
			kind: 'tofu';
			address: string;
			previousPinned: string;
			previousVerifiedAt: string;
			currentFingerprint: string;
			shared: boolean;
	  }
	| {
			kind: 'external-key-change';
			address: string;
			currentFingerprint: string;
	  }
	| {
			kind: 'directory';
			address: string;
			requestedAddress: string;
			statementAddress?: string;
			signedKeyFingerprint?: string;
			servedKeyFingerprint?: string;
			expectedSignerFingerprint?: string;
			actualSignerFingerprint?: string;
			seenVersion?: number;
			servedVersion?: number;
	  }
	| {
			kind: 'rate_limited';
			retryAfterSeconds: number;
	  };

export class SendError extends Error {
	code: SendErrorCode;
	inner?: DirectoryVerificationCode;
	payload?: SendErrorPayload;
	constructor(
		code: SendErrorCode,
		message?: string,
		inner?: DirectoryVerificationCode,
		payload?: SendErrorPayload
	) {
		super(message ?? code);
		this.code = code;
		this.inner = inner;
		this.payload = payload;
		this.name = 'SendError';
	}
}

export function rateLimitedSendError(e: ApiCallError): SendError {
	const retryAfterSeconds = e.envelope?.error?.retryAfterSeconds ?? 0;
	const message =
		e.envelope?.error?.message ?? m.send_error_rate_limited();
	return new SendError('rate_limited', message, undefined, { kind: 'rate_limited', retryAfterSeconds });
}

const SENDER_REFUSALS: Partial<Record<ErrorCode, () => string>> = {
	sender_address_suspended: () => m.send_error_sender_suspended(),
	sending_not_verified: () => m.send_error_sending_not_verified(),
	domain_paused: () => m.send_error_domain_paused(),
	payload_too_large: () => m.send_error_message_too_large(),
	invalid_message: () => m.send_error_message_refused(),
	intent_not_found: () => m.send_error_upload_expired()
};

export function sendErrorFromApi(e: unknown, fallback: string): SendError {
	if (e instanceof SendError) return e;
	if (e instanceof ApiCallError) {
		const refusal = e.envelope?.error?.code ? SENDER_REFUSALS[e.envelope.error.code] : undefined;
		if (refusal) return new SendError('rejected', refusal());
		const message = e.envelope?.error?.message ?? m.send_error_http({ reason: fallback, status: e.status });
		if (e.status === 429) return rateLimitedSendError(e);
		if (e.envelope?.error?.code === 'scanner_unavailable') {
			return new SendError('server_error', m.send_error_scanner_unavailable(), undefined, {
				kind: 'rate_limited',
				retryAfterSeconds: e.envelope.error.retryAfterSeconds ?? 0
			});
		}
		if (e.status === 401) return new SendError('locked', message);
		if (e.envelope?.error?.code === 'content_rejected') {
			return new SendError('malware_blocked', message);
		}
		if (e.status >= 500) return new SendError('server_error', message);
		if (e.status >= 400) return new SendError('rejected', message);
		return new SendError('unknown', message);
	}
	return new SendError('network', e instanceof Error ? e.message : fallback);
}

interface KeyMaterial {
	publicKeyArmored: string;
	fingerprintB64: string;
}

const cachedSenderKeys = new Map<string, KeyMaterial>();

if (typeof window !== 'undefined') {
	keystore.subscribe((msg) => {
		if (msg.type === 'clearedAll') {
			cachedSenderKeys.clear();
			return;
		}
		if (
			msg.type === 'locked' ||
			msg.type === 'cleared' ||
			msg.type === 'persistentDisabled' ||
			msg.type === 'aliasKeysChanged'
		) {
			for (const key of [...cachedSenderKeys.keys()]) {
				if (key.startsWith(`${msg.accountId}:`)) cachedSenderKeys.delete(key);
			}
		}
	});
}

export async function senderKey(accountId: string, aliasId?: string): Promise<KeyMaterial> {
	const cacheKey = `${accountId}:${aliasId ?? ''}`;
	const existing = cachedSenderKeys.get(cacheKey);
	if (existing) return existing;
	const r = await keystore.getPublicKey({ accountId, aliasId });
	if (!r.ok) {
		throw new SendError(
			'locked',
			aliasId
				? m.send_error_alias_key_changed()
				: m.send_error_vault_locked()
		);
	}
	const km: KeyMaterial = {
		publicKeyArmored: r.publicKeyArmored,
		fingerprintB64: bytesToB64(r.fingerprint)
	};
	cachedSenderKeys.set(cacheKey, km);
	return km;
}

export type { KeyMaterial };

async function fingerprintFromArmored(armoredPublicKey: string): Promise<string> {
	try {
		const k = await openpgp.readKey({ armoredKey: armoredPublicKey });
		const fp = k.getFingerprint();
		const bytes = typeof fp === 'string' ? hexToBytes(fp) : new Uint8Array(fp as ArrayLike<number>);
		return bytesToB64(bytes);
	} catch (e) {
		throw new SendError(
			'recipient_key_invalid',
			e instanceof Error ? e.message : 'invalid recipient key'
		);
	}
}

function normaliseEmail(s: string): string {
	return s.trim().toLowerCase();
}

interface ResolveOptions {
	acceptKeyChange?: boolean;
}

function directoryPayload(
	e: DirectoryVerificationError,
	requestedAddress: string
): SendErrorPayload {
	const d = e.details;
	const fmt = (hex?: string) => (hex ? formatFingerprintHex(hex) : undefined);
	return {
		kind: 'directory',
		address: requestedAddress,
		requestedAddress,
		statementAddress: d.statementAddress,
		signedKeyFingerprint: fmt(d.signedKeyFingerprint),
		servedKeyFingerprint: fmt(d.servedKeyFingerprint),
		expectedSignerFingerprint: fmt(
			d.expectedSignerFingerprint ?? DIRECTORY_SIGNING_KEY_FINGERPRINT_HEX
		),
		actualSignerFingerprint: fmt(d.actualSignerFingerprint),
		seenVersion: d.previousVersion,
		servedVersion: d.currentVersion
	};
}

function tofuPayload(
	e: DirectoryVerificationError,
	address: string,
	shared = false
): SendErrorPayload | null {
	const d = e.details;
	if (
		!d.previousFingerprint ||
		!d.currentFingerprint ||
		typeof d.previousVersion !== 'number' ||
		typeof d.previousVerifiedAtMillis !== 'number'
	) {
		return null;
	}
	return {
		kind: 'tofu',
		address,
		previousPinned: formatFingerprintHex(d.previousFingerprint),
		previousVerifiedAt: formatVerifiedAt(d.previousVerifiedAtMillis, d.previousVersion),
		currentFingerprint: formatFingerprintHex(d.currentFingerprint),
		shared
	};
}

interface VerifiedReadDelegate {
	id: string;
	publicKeyArmored: string;
}

interface ResolvedRecipient {
	accountId: string;
	key: KeyMaterial;
	fullName: string;
	readDelegates: VerifiedReadDelegate[];
}

async function verifiedReadDelegates(
	delegates: ReadDelegate[] | undefined,
	address: string
): Promise<VerifiedReadDelegate[]> {
	const out: VerifiedReadDelegate[] = [];
	for (const d of delegates ?? []) {
		try {
			await verifyReadDelegate(d, address);
			out.push({ id: d.id, publicKeyArmored: d.publicKeyArmored });
		} catch (e) {
			console.warn('send: read delegate did not verify', d.id, e);
		}
	}
	return out;
}

async function resolveRecipient(
	emailAddress: string,
	opts: ResolveOptions = {}
): Promise<ResolvedRecipient> {
	const normalised = canonicalRecipient(emailAddress);
	let lookup;
	try {
		lookup = await lookupDirectory(normalised);
	} catch (e) {
		if (e instanceof ApiCallError && e.status === 404) {
			throw new SendError('recipient_unknown', m.send_error_no_account_at({ address: emailAddress }));
		}
		throw sendErrorFromApi(e, m.send_error_recipient_lookup_failed());
	}

	try {
		await verifyDirectoryLookup(lookup, normalised, { acceptKeyChange: opts.acceptKeyChange });
	} catch (e) {
		if (e instanceof DirectoryVerificationError) {
			if (e.code === 'fingerprint_changed') {
				const payload = tofuPayload(e, normalised, lookup.shared === true);
				throw new SendError(
					'tofu',
					m.send_error_recipient_key_changed(),
					e.code,
					payload ?? undefined
				);
			}
			throw new SendError(
				'directory_verification_failed',
				m.send_error_directory_failed({ address: emailAddress, code: e.code }),
				e.code,
				directoryPayload(e, normalised)
			);
		}
		throw new SendError('directory_verification_failed', e instanceof Error ? e.message : 'verify');
	}

	const fingerprintB64 = await fingerprintFromArmored(lookup.publicKeyArmored);
	return {
		accountId: lookup.accountId,
		fullName: lookup.fullName,
		key: { publicKeyArmored: lookup.publicKeyArmored, fingerprintB64 },
		readDelegates: await verifiedReadDelegates(lookup.readDelegates, normalised)
	};
}

async function sha256B64(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
	return bytesToB64(new Uint8Array(digest));
}

async function encryptTo(
	accountId: string,
	plaintext: Uint8Array,
	recipientArmored: string
): Promise<Uint8Array> {
	const r = await keystore.encrypt({
		accountId,
		recipientPublicKeyArmored: recipientArmored,
		plaintext
	});
	if (!r.ok) {
		throw new SendError(r.code === 'locked' ? 'locked' : 'encrypt', `keystore.encrypt: ${r.code}`);
	}
	return r.ciphertext;
}

export async function buildEnvelope(
	accountId: string,
	previewBytes: Uint8Array,
	bodyBytes: Uint8Array,
	key: KeyMaterial,
	attachments: AttachmentDescriptor[] = []
): Promise<SendEnvelope> {
	const [previewCipher, bodyCipher] = await Promise.all([
		encryptTo(accountId, previewBytes, key.publicKeyArmored),
		encryptTo(accountId, bodyBytes, key.publicKeyArmored)
	]);
	const bodySha = await sha256B64(bodyCipher);
	return {
		encryptedPreview: bytesToB64(previewCipher),
		previewKeyFingerprint: key.fingerprintB64,
		encryptedBody: bytesToB64(bodyCipher),
		bodyKeyFingerprint: key.fingerprintB64,
		bodySha256: bodySha,
		bodySizeBytes: bodyCipher.length,
		attachments
	};
}

export function buildPreview(
	input: ComposeInput,
	includeBcc: boolean,
	now: Date
): MessagePreview {
	const fromAddress = input.fromEmail ?? '';
	const fromName = input.fromName ?? fromAddress;
	const recipients: MessagePreviewRecipient[] = [];
	for (const p of input.to) recipients.push({ display: p.display, address: p.address, kind: 'to' });
	for (const p of input.cc ?? []) {
		recipients.push({ display: p.display, address: p.address, kind: 'cc' });
	}
	if (includeBcc) {
		for (const p of input.bcc ?? []) {
			recipients.push({ display: p.display, address: p.address, kind: 'bcc' });
		}
	}
	return {
		v: 1,
		subject: input.subject,
		sender: { display: fromName, address: fromAddress },
		recipients,
		snippet: snippetSource(input.body).slice(0, 280),
		display_date: now.toISOString(),
		flags: input.calendar ? { calendar: input.calendar.method } : {}
	};
}

export interface InternalSendOptions {
	acceptKeyChange?: boolean;
	deliverOnly?: ReadonlySet<string>;
}

export function releaseDate(scheduledAt?: string): Date {
	if (!scheduledAt) return new Date();
	const d = new Date(scheduledAt);
	if (Number.isNaN(d.getTime())) {
		throw new SendError('rejected', m.send_error_bad_send_time());
	}
	return d;
}

export async function sendInternalMessage(
	input: ComposeInput,
	opts: InternalSendOptions = {}
): Promise<InternalSendResponse> {
	if (!auth.accountId) {
		throw new SendError('no_account', m.send_error_not_signed_in());
	}
	const accountId = auth.accountId;
	const fromAddress = input.fromEmail ?? auth.email ?? 'me@thelemail.local';
	const fromName = input.fromName ?? auth.fullName ?? fromAddress;

	const sender = await senderKey(accountId, input.fromAliasId);

	const allParties = [...input.to, ...(input.cc ?? []), ...(input.bcc ?? [])];
	const deliverable = opts.deliverOnly
		? allParties.filter((p) => opts.deliverOnly!.has(normaliseEmail(p.address)))
		: allParties;
	if (deliverable.length === 0) {
		throw new SendError('no_account', m.send_error_no_recipients());
	}

	const resolutions = new Map<string, ResolvedRecipient>();
	const deliveredTo = new Map<string, string>();
	for (const p of deliverable) {
		const addr = canonicalRecipient(p.address);
		let r = resolutions.get(addr);
		if (!r) {
			r = await resolveRecipient(p.address, { acceptKeyChange: opts.acceptKeyChange });
			resolutions.set(addr, r);
		}
		const typed = normaliseEmail(p.address);
		if (typed !== addr && !deliveredTo.has(r.accountId)) deliveredTo.set(r.accountId, typed);
	}
	const keyByAccount = new Map<string, KeyMaterial>();
	const addressByAccount = new Map<string, string>();
	for (const [addr, r] of resolutions) {
		if (!keyByAccount.has(r.accountId)) keyByAccount.set(r.accountId, r.key);
		if (!addressByAccount.has(r.accountId)) addressByAccount.set(r.accountId, addr);
	}

	const enrich = (p: ReplyParty): ReplyParty => {
		const r = resolutions.get(canonicalRecipient(p.address));
		return r && r.fullName ? { display: r.fullName, address: p.address } : p;
	};
	const to = input.to.map(enrich);
	const cc = input.cc && input.cc.length ? input.cc.map(enrich) : undefined;
	const bcc = input.bcc && input.bcc.length ? input.bcc.map(enrich) : undefined;

	const now = releaseDate(input.scheduledAt);
	const messageUuid = crypto.randomUUID();
	const domain = messageIdDomain(fromAddress);
	const externalMessageId = `<${messageUuid}@${domain}>`;
	const packed = await packBodyForSend(input.bodyHtml);
	const mimeArgs: BuildMIMEArgs = {
		fromName,
		fromAddress,
		to,
		cc,
		bcc,
		replyTo: input.replyTo,
		subject: input.subject,
		body: input.body,
		bodyHtml: packed.bodyHtml,
		date: now,
		messageId: messageUuid,
		messageIdDomain: domain,
		inReplyTo: input.inReplyToHeader,
		references: input.references,
		calendar: input.calendar,
		relatedParts: packed.relatedParts
	};
	const enriched: ComposeInput = { ...input, to, cc, bcc, fromEmail: fromAddress, fromName };

	const encode = (p: MessagePreview) => new TextEncoder().encode(JSON.stringify(p));
	const senderMime = buildMIME(mimeArgs);
	const senderPreview = encode(buildPreview(enriched, true, now));
	const hasBcc = !!bcc;
	const recipientMime = hasBcc ? buildMIME({ ...mimeArgs, bcc: undefined }) : senderMime;
	const recipientBasePreview = buildPreview(enriched, false, now);
	const recipientPreview = hasBcc ? encode(recipientBasePreview) : senderPreview;
	const previewFor = (id: string): Uint8Array => {
		const tagged = deliveredTo.get(id);
		return tagged ? encode({ ...recipientBasePreview, delivered_to: tagged }) : recipientPreview;
	};

	const senderAtts: AttachmentDescriptor[] = [];
	const attsByAccount = new Map<string, AttachmentDescriptor[]>();
	if (input.attachments) {
		for (let i = 0; i < input.attachments.length; i++) {
			const a = input.attachments[i];
			if (!a.senderDescriptor) {
				throw new SendError('encrypt', m.send_error_attachments_uploading());
			}
			senderAtts.push({ ...a.senderDescriptor, ordinal: i });
		}
		for (const acct of keyByAccount.keys()) {
			const list: AttachmentDescriptor[] = [];
			for (let i = 0; i < input.attachments.length; i++) {
				const rec = input.attachments[i].recipientDescriptors?.get(acct);
				if (!rec) {
					throw new SendError('encrypt', m.send_error_attachments_uploading_recipient());
				}
				list.push({ ...rec, ordinal: i });
			}
			attsByAccount.set(acct, list);
		}
	}

	const accountIds = [...keyByAccount.keys()];
	const [sentEnv, ...recipientEnvs] = await Promise.all([
		buildEnvelope(accountId, senderPreview, senderMime, sender, senderAtts),
		...accountIds.map((id) =>
			buildEnvelope(
				accountId,
				previewFor(id),
				recipientMime,
				keyByAccount.get(id)!,
				attsByAccount.get(id) ?? []
			)
		)
	]);

	const forwardCopies = await buildForwardCopies(
		accountId,
		input,
		resolutions.values(),
		() => composeMimeBytes({ ...mimeArgs, bcc: undefined, attachments: readMimeAttachments(input.attachments ?? []) })
	);

	const req: InternalSendRequest = {
		idempotencyKey: crypto.randomUUID(),
		schemaVersion: 1,
		source: 'internal',
		sent: sentEnv,
		recipients: accountIds.map((id, i) => ({
			accountId: id,
			envelope: recipientEnvs[i],
			address: addressByAccount.get(id)
		})),
		externalMessageId,
		inReplyToMessageId: input.inReplyToMessageId,
		inReplyToHeader: input.inReplyToHeader,
		references: input.references && input.references.length ? input.references : undefined,
		scheduledAt: input.scheduledAt,
		forwardCopies: forwardCopies.length ? forwardCopies : undefined,
		forwardReplyTo: forwardCopies.length ? (input.fromEmail ?? auth.email ?? undefined) : undefined,
		from: input.fromEmail ?? auth.email ?? undefined
	};

	try {
		return await sendInternal(req);
	} catch (err) {
		throw sendErrorFromApi(err, m.send_error_sending_failed());
	}
}

async function buildForwardCopies(
	accountId: string,
	input: ComposeInput,
	resolved: Iterable<ResolvedRecipient>,
	message: () => Promise<Uint8Array>
): Promise<ForwardCopy[]> {
	const targets = new Map<string, { recipientAccountId: string; publicKeyArmored: string }>();
	for (const r of resolved) {
		for (const d of r.readDelegates) {
			if (!targets.has(d.id)) {
				targets.set(d.id, { recipientAccountId: r.accountId, publicKeyArmored: d.publicKeyArmored });
			}
		}
	}
	if (targets.size === 0) return [];
	const plaintext = await message();
	const copies: ForwardCopy[] = [];
	for (const [readDelegationId, target] of targets) {
		const r = await keystore.encryptToKeys({
			accountId,
			recipientPublicKeysArmored: [target.publicKeyArmored],
			plaintext,
			aliasId: input.fromAliasId
		});
		if (!r.ok) {
			throw new SendError(r.code === 'locked' ? 'locked' : 'encrypt', `keystore.encryptToKeys: ${r.code}`);
		}
		copies.push({ readDelegationId, recipientAccountId: target.recipientAccountId, encryptedMessage: r.armored });
	}
	return copies;
}
