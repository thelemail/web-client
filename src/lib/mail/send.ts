import * as openpgp from 'openpgp';
import { auth } from '$lib/stores/auth.svelte';
import { keystore } from '$lib/keystore/keystore-client';
import { bytesToB64, hexToBytes } from '$lib/crypto';
import { sendInternal } from '$lib/api/messages';
import { lookupAccount } from '$lib/api/accounts';
import { ApiCallError } from '$lib/api/types';
import type {
	AttachmentDescriptor,
	InternalSendRequest,
	InternalSendResponse,
	SendEnvelope
} from '$lib/api/types';
import type { Attachment as ComposeAttachment } from './attachmentUpload';
import { verifyDirectoryLookup, DirectoryVerificationError } from '$lib/directory/verify';
import type { DirectoryVerificationCode } from '$lib/directory/verify';
import { DIRECTORY_SIGNING_KEY_FINGERPRINT_HEX } from '$lib/directory/signing-key';
import { formatFingerprintHex, formatVerifiedAt } from '$lib/directory/format';
import type { MessagePreview, MessagePreviewRecipient } from './preview';
import type { ReplyParty } from './replyRecipients';
import { packBodyForSend } from './signaturePack';
import { snippetSource } from './quote';

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
		e.envelope?.error?.message ?? "You've reached your sending limit. Try again later.";
	return new SendError('rate_limited', message, undefined, { kind: 'rate_limited', retryAfterSeconds });
}

export function sendErrorFromApi(e: unknown, fallback: string): SendError {
	if (e instanceof SendError) return e;
	if (e instanceof ApiCallError) {
		const message = e.envelope?.error?.message ?? `${fallback} (HTTP ${e.status})`;
		if (e.status === 429) return rateLimitedSendError(e);
		if (e.status === 401) return new SendError('locked', message);
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
		if (msg.type === 'locked' || msg.type === 'cleared' || msg.type === 'persistentDisabled') {
			cachedSenderKeys.delete(msg.accountId);
		} else if (msg.type === 'clearedAll') {
			cachedSenderKeys.clear();
		}
	});
}

export async function senderKey(accountId: string): Promise<KeyMaterial> {
	const existing = cachedSenderKeys.get(accountId);
	if (existing) return existing;
	const r = await keystore.getPublicKey({ accountId });
	if (!r.ok) {
		throw new SendError('locked', 'Vault is locked; sign in to send.');
	}
	const km: KeyMaterial = {
		publicKeyArmored: r.publicKeyArmored,
		fingerprintB64: bytesToB64(r.fingerprint)
	};
	cachedSenderKeys.set(accountId, km);
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

function tofuPayload(e: DirectoryVerificationError, address: string): SendErrorPayload | null {
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
		currentFingerprint: formatFingerprintHex(d.currentFingerprint)
	};
}

async function resolveRecipient(
	emailAddress: string,
	opts: ResolveOptions = {}
): Promise<{ accountId: string; key: KeyMaterial; fullName: string }> {
	const normalised = normaliseEmail(emailAddress);
	let lookup;
	try {
		lookup = await lookupAccount(emailAddress);
	} catch (e) {
		if (e instanceof ApiCallError && e.status === 404) {
			throw new SendError('recipient_unknown', `No Thelemail account at ${emailAddress}`);
		}
		throw sendErrorFromApi(e, 'Recipient lookup failed');
	}

	try {
		await verifyDirectoryLookup(lookup, normalised, { acceptKeyChange: opts.acceptKeyChange });
	} catch (e) {
		if (e instanceof DirectoryVerificationError) {
			if (e.code === 'fingerprint_changed') {
				const payload = tofuPayload(e, normalised);
				throw new SendError(
					'tofu',
					`Recipient key has changed since you last verified them.`,
					e.code,
					payload ?? undefined
				);
			}
			throw new SendError(
				'directory_verification_failed',
				`Directory signature failed for ${emailAddress} — cannot safely send. Reason: ${e.code}`,
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
		key: { publicKeyArmored: lookup.publicKeyArmored, fingerprintB64 }
	};
}

export interface RelatedMIMEPart {
	contentId: string;
	contentType: string;
	bytes: Uint8Array;
}

export interface MIMEAttachment {
	filename: string;
	contentType: string;
	bytes: Uint8Array;
	disposition?: 'attachment' | 'inline';
	contentId?: string;
}

export interface BuildMIMEArgs {
	fromName: string;
	fromAddress: string;
	to: ReplyParty[];
	cc?: ReplyParty[];
	bcc?: ReplyParty[];
	replyTo?: ReplyParty;
	subject: string;
	body: string;
	bodyHtml?: string;
	date: Date;
	messageId: string;
	messageIdDomain?: string;
	inReplyTo?: string;
	references?: string[];
	calendar?: { method: 'REQUEST' | 'REPLY' | 'CANCEL'; ics: string };
	relatedParts?: RelatedMIMEPart[];
	attachments?: MIMEAttachment[];
}

function formatParty(p: ReplyParty): string {
	return mailbox(p.display, p.address);
}

function formatParties(parties: ReplyParty[]): string {
	return parties.map(formatParty).join(', ');
}

export function messageIdDomain(fromAddress: string): string {
	const clean = escapeAddress(fromAddress);
	const at = clean.lastIndexOf('@');
	const domain = at >= 0 ? clean.slice(at + 1) : '';
	return domain || 'thelemail.local';
}

export function buildMIME(args: BuildMIMEArgs): Uint8Array {
	const domain = escapeAddress(args.messageIdDomain ?? '') || 'thelemail.local';
	const headers: string[] = [foldHeader('From', mailbox(args.fromName, args.fromAddress))];
	if (args.to.length) headers.push(foldHeader('To', formatParties(args.to)));
	if (args.cc && args.cc.length) headers.push(foldHeader('Cc', formatParties(args.cc)));
	if (args.bcc && args.bcc.length) headers.push(foldHeader('Bcc', formatParties(args.bcc)));
	if (args.replyTo) headers.push(foldHeader('Reply-To', formatParty(args.replyTo)));
	headers.push(
		foldHeader('Subject', encodeHeaderText(args.subject) || '(no subject)'),
		`Date: ${headerValue(args.date.toUTCString())}`,
		`Message-ID: ${ensureAngled(`${args.messageId}@${domain}`)}`,
		'MIME-Version: 1.0'
	);
	const inReplyTo = args.inReplyTo ? ensureAngled(args.inReplyTo) : '';
	if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`);
	if (args.references && args.references.length) {
		const refs = args.references.map((r) => ensureAngled(r)).filter((r) => r.length > 0);
		if (refs.length) headers.push(foldHeader('References', refs.join(' ')));
	}

	const content = renderContentEntity(args);
	headers.push(...content.headerLines);
	const out = headers.join('\r\n') + '\r\n\r\n' + content.body;
	return new TextEncoder().encode(out);
}

export function buildBodyEntity(args: BuildMIMEArgs): Uint8Array {
	const content = renderContentEntity(args);
	const out = content.headerLines.join('\r\n') + '\r\n\r\n' + content.body;
	return new TextEncoder().encode(out);
}

function renderContentEntity(args: BuildMIMEArgs): { headerLines: string[]; body: string } {
	const text = normalizeCRLF(args.body || '');
	const html = args.bodyHtml ? normalizeCRLF(args.bodyHtml) : undefined;
	const related = (args.relatedParts ?? []).filter((p) => p.bytes && p.bytes.length > 0);
	const attachments = (args.attachments ?? []).filter((a) => a.bytes && a.bytes.length > 0);

	if (attachments.length > 0 || args.calendar) {
		const parts = [renderBodyAlternative(text, html, related)];
		for (const att of attachments) {
			parts.push(renderAttachmentPart(att));
		}
		if (args.calendar) {
			parts.push(renderCalendarPart(args.calendar));
		}
		const boundary = makeBoundary('mix', parts);
		const segments = parts.map((p) => `--${boundary}\r\n${p}`);
		segments.push(`--${boundary}--`);
		return {
			headerLines: [`Content-Type: multipart/mixed; boundary="${boundary}"`],
			body: `This is a multipart message in MIME format.\r\n\r\n` + segments.join('\r\n') + '\r\n'
		};
	}
	if (html) {
		const parts = [
			renderTextPart(text),
			related.length > 0 ? renderHtmlRelated(html, related) : renderHtmlPart(html)
		];
		const boundary = makeBoundary('alt', parts);
		return {
			headerLines: [`Content-Type: multipart/alternative; boundary="${boundary}"`],
			body:
				`This is a multipart message in MIME format.\r\n\r\n` +
				parts.map((p) => `--${boundary}\r\n${p}\r\n`).join('') +
				`--${boundary}--\r\n`
		};
	}
	return {
		headerLines: ['Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit'],
		body: text
	};
}

function renderAttachmentPart(att: MIMEAttachment): string {
	const b64 = base64Wrap(att.bytes);
	const name = headerParam(att.filename) || 'attachment';
	const disposition = att.disposition === 'inline' ? 'inline' : 'attachment';
	const angledCid = att.contentId ? ensureAngled(att.contentId) : '';
	const cid = angledCid ? `Content-ID: ${angledCid}\r\n` : '';
	return (
		`Content-Type: ${escapeContentType(att.contentType)}; name="${name}"\r\n` +
		'Content-Transfer-Encoding: base64\r\n' +
		cid +
		`Content-Disposition: ${disposition}; filename="${name}"\r\n\r\n` +
		b64
	);
}

function renderBodyAlternative(text: string, html?: string, related: RelatedMIMEPart[] = []): string {
	if (!html) {
		return renderTextPart(text);
	}
	const parts = [
		renderTextPart(text),
		related.length > 0 ? renderHtmlRelated(html, related) : renderHtmlPart(html)
	];
	const boundary = makeBoundary('alt', parts);
	return (
		`Content-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n` +
		parts.map((p) => `--${boundary}\r\n${p}\r\n`).join('') +
		`--${boundary}--`
	);
}

function renderTextPart(text: string): string {
	return (
		'Content-Type: text/plain; charset=utf-8\r\n' +
		'Content-Transfer-Encoding: 8bit\r\n\r\n' +
		text
	);
}

function renderHtmlPart(html: string): string {
	const b64 = base64Wrap(new TextEncoder().encode(html));
	return (
		'Content-Type: text/html; charset=utf-8\r\n' +
		'Content-Transfer-Encoding: base64\r\n\r\n' +
		b64
	);
}

function renderHtmlRelated(html: string, parts: RelatedMIMEPart[]): string {
	const rendered = [renderHtmlPart(html), ...parts.map(renderInlineImagePart)];
	const boundary = makeBoundary('rel', rendered);
	const segments = rendered.map((p) => `--${boundary}\r\n${p}`);
	segments.push(`--${boundary}--`);
	return (
		`Content-Type: multipart/related; type="text/html"; boundary="${boundary}"\r\n\r\n` +
		segments.join('\r\n')
	);
}

function renderInlineImagePart(part: RelatedMIMEPart): string {
	const b64 = base64Wrap(part.bytes);
	const cid = ensureAngled(part.contentId);
	return (
		`Content-Type: ${escapeContentType(part.contentType)}\r\n` +
		'Content-Transfer-Encoding: base64\r\n' +
		`Content-ID: ${cid}\r\n` +
		'Content-Disposition: inline\r\n\r\n' +
		b64
	);
}

function renderCalendarPart(cal: { method: string; ics: string }): string {
	const method = cal.method.toUpperCase().replace(/[^A-Z]/g, '') || 'REQUEST';
	const b64 = base64Wrap(new TextEncoder().encode(normalizeCRLF(cal.ics)));
	return (
		`Content-Type: text/calendar; method=${method}; charset=utf-8\r\n` +
		'Content-Transfer-Encoding: base64\r\n' +
		'Content-Disposition: attachment; filename="invite.ics"\r\n\r\n' +
		b64
	);
}

const BOUNDARY_ATTEMPTS = 16;

function makeBoundary(tag: string, parts: string[]): string {
	for (let i = 0; i < BOUNDARY_ATTEMPTS; i++) {
		const candidate = `=_thelemail_${tag}_${crypto.randomUUID()}`;
		if (!parts.some((p) => p.includes(candidate))) return candidate;
	}
	throw new SendError('encrypt', 'Could not build the message body.');
}

function base64Wrap(bytes: Uint8Array): string {
	let bin = '';
	for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
	const b64 = btoa(bin);
	return b64.replace(/(.{76})/g, '$1\r\n');
}

function ensureAngled(id: string): string {
	const s = headerValue(id).replace(/[<>\s]/g, '');
	return s ? `<${s}>` : '';
}

function normalizeCRLF(s: string): string {
	return s.replace(/\r?\n/g, '\r\n');
}

function headerValue(s: string): string {
	// eslint-disable-next-line no-control-regex
	return s.replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029]/g, '');
}

const HEADER_LINE_LIMIT = 78;
const HEADER_TOKEN_LIMIT = 60;
const ENCODED_WORD_BYTES = 45;

function isPlainHeaderText(s: string): boolean {
	for (const ch of s) {
		const c = ch.codePointAt(0)!;
		if (c < 0x20 || c > 0x7e) return false;
	}
	return !s.split(' ').some((token) => token.length > HEADER_TOKEN_LIMIT);
}

function encodedWord(bytes: number[]): string {
	return `=?utf-8?B?${bytesToB64(new Uint8Array(bytes))}?=`;
}

function encodeHeaderText(s: string): string {
	const value = headerValue(s);
	if (isPlainHeaderText(value)) return value;
	const encoder = new TextEncoder();
	const words: string[] = [];
	let chunk: number[] = [];
	for (const ch of value) {
		const bytes = encoder.encode(ch);
		if (chunk.length > 0 && chunk.length + bytes.length > ENCODED_WORD_BYTES) {
			words.push(encodedWord(chunk));
			chunk = [];
		}
		for (const b of bytes) chunk.push(b);
	}
	if (chunk.length > 0) words.push(encodedWord(chunk));
	return words.join(' ');
}

function foldHeader(name: string, value: string): string {
	if (!value) return `${name}:`;
	const lines: string[] = [];
	let line = `${name}:`;
	let empty = true;
	for (const word of value.split(' ')) {
		if (!empty && line.length + 1 + word.length > HEADER_LINE_LIMIT) {
			lines.push(line);
			line = ` ${word}`;
		} else {
			line += ` ${word}`;
			empty = false;
		}
	}
	lines.push(line);
	return lines.join('\r\n');
}

function headerText(s: string): string {
	return headerValue(s).replace(/"/g, '').slice(0, 200);
}

function quotedText(s: string): string {
	return s.replace(/\\/g, '\\\\');
}

function mailbox(display: string, address: string): string {
	const addr = escapeAddress(address);
	const name = headerText(display);
	if (!name) return addr;
	return isPlainHeaderText(name)
		? `"${quotedText(name)}" <${addr}>`
		: `${encodeHeaderText(name)} <${addr}>`;
}

function headerParam(s: string): string {
	const value = headerText(s);
	return isPlainHeaderText(value) ? quotedText(value) : encodeHeaderText(value);
}

function escapeAddress(s: string): string {
	return headerValue(s)
		.replace(/[<>,;:"\\()[\]\s]/g, '')
		.slice(0, 320);
}

function escapeContentType(s: string): string {
	const t = headerValue(s)
		.replace(/[;"\\()<>,:[\]?=\s]/g, '')
		.slice(0, 200);
	return t || 'application/octet-stream';
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
		flags: {}
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
		throw new SendError('rejected', 'That send time could not be read. Pick a time again.');
	}
	return d;
}

export async function sendInternalMessage(
	input: ComposeInput,
	opts: InternalSendOptions = {}
): Promise<InternalSendResponse> {
	if (!auth.accountId) {
		throw new SendError('no_account', 'Not signed in.');
	}
	const accountId = auth.accountId;
	const fromAddress = input.fromEmail ?? auth.email ?? 'me@thelemail.local';
	const fromName = input.fromName ?? auth.fullName ?? fromAddress;

	const sender = await senderKey(accountId);

	const allParties = [...input.to, ...(input.cc ?? []), ...(input.bcc ?? [])];
	const deliverable = opts.deliverOnly
		? allParties.filter((p) => opts.deliverOnly!.has(normaliseEmail(p.address)))
		: allParties;
	if (deliverable.length === 0) {
		throw new SendError('no_account', 'At least one recipient is required.');
	}

	const resolutions = new Map<
		string,
		{ accountId: string; key: KeyMaterial; fullName: string }
	>();
	for (const p of deliverable) {
		const addr = normaliseEmail(p.address);
		if (resolutions.has(addr)) continue;
		resolutions.set(addr, await resolveRecipient(p.address, { acceptKeyChange: opts.acceptKeyChange }));
	}
	const keyByAccount = new Map<string, KeyMaterial>();
	for (const r of resolutions.values()) {
		if (!keyByAccount.has(r.accountId)) keyByAccount.set(r.accountId, r.key);
	}

	const enrich = (p: ReplyParty): ReplyParty => {
		const r = resolutions.get(normaliseEmail(p.address));
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
	const recipientPreview = hasBcc ? encode(buildPreview(enriched, false, now)) : senderPreview;

	const senderAtts: AttachmentDescriptor[] = [];
	const attsByAccount = new Map<string, AttachmentDescriptor[]>();
	if (input.attachments) {
		for (let i = 0; i < input.attachments.length; i++) {
			const a = input.attachments[i];
			if (!a.senderDescriptor) {
				throw new SendError('encrypt', 'Some attachments are still uploading.');
			}
			senderAtts.push({ ...a.senderDescriptor, ordinal: i });
		}
		for (const acct of keyByAccount.keys()) {
			const list: AttachmentDescriptor[] = [];
			for (let i = 0; i < input.attachments.length; i++) {
				const rec = input.attachments[i].recipientDescriptors?.get(acct);
				if (!rec) {
					throw new SendError('encrypt', 'Some attachments are still uploading for this recipient.');
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
				recipientPreview,
				recipientMime,
				keyByAccount.get(id)!,
				attsByAccount.get(id) ?? []
			)
		)
	]);

	const req: InternalSendRequest = {
		idempotencyKey: crypto.randomUUID(),
		schemaVersion: 1,
		source: 'internal',
		sent: sentEnv,
		recipients: accountIds.map((id, i) => ({ accountId: id, envelope: recipientEnvs[i] })),
		externalMessageId,
		inReplyToMessageId: input.inReplyToMessageId,
		inReplyToHeader: input.inReplyToHeader,
		references: input.references && input.references.length ? input.references : undefined,
		scheduledAt: input.scheduledAt
	};

	try {
		return await sendInternal(req);
	} catch (err) {
		throw sendErrorFromApi(err, 'Sending failed');
	}
}
