import * as openpgp from 'openpgp';
import { platform } from '$platform';
import { keystore } from '$lib/keystore/keystore-client';
import { bytesToB64, hexToBytes } from '$lib/crypto';
import { lookupAccount } from '$lib/api/accounts';
import { ApiCallError } from '$lib/api/types';
import { issueAttachmentUploadUrls } from '$lib/api/messages';
import { build as buildAttFrame } from './attframe';
import { senderKey, SendError, type KeyMaterial } from './send';
import type {
	AttachmentDescriptor,
	AttachmentUploadGrant,
	AttachmentUploadSlotRequest
} from '$lib/api/types';

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
export const MAX_ATTACHMENTS = 20;

export type AttachmentStatus =
	| 'queued'
	| 'encrypting'
	| 'uploading'
	| 'ready'
	| 'error'
	| 'cancelled';

export interface Attachment {
	id: string;
	file: File;
	status: AttachmentStatus;
	progress: number;
	error?: string;
	senderDescriptor?: AttachmentDescriptor;
	recipientDescriptors?: Map<string, AttachmentDescriptor>;
	disposition: 'attachment' | 'inline';
	contentId?: string;
	cancelled?: boolean;
}

interface RecipientResolution {
	accountId: string;
	publicKeyArmored: string;
	fingerprintB64: string;
}

async function recipientForAddress(address: string): Promise<RecipientResolution> {
	const lookup = await lookupAccount(address);
	const k = await openpgp.readKey({ armoredKey: lookup.publicKeyArmored });
	const fp = k.getFingerprint();
	const bytes = typeof fp === 'string' ? hexToBytes(fp) : new Uint8Array(fp as ArrayLike<number>);
	return {
		accountId: lookup.accountId,
		publicKeyArmored: lookup.publicKeyArmored,
		fingerprintB64: bytesToB64(bytes)
	};
}

async function encryptToArmored(
	accountId: string,
	plaintext: Uint8Array,
	armored: string
): Promise<Uint8Array> {
	const r = await keystore.encrypt({ accountId, recipientPublicKeyArmored: armored, plaintext });
	if (!r.ok) throw new SendError('encrypt', `keystore.encrypt: ${r.code}`);
	return r.ciphertext;
}

async function sha256B64(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
	return bytesToB64(new Uint8Array(digest));
}

async function putWithProgress(url: string, body: Uint8Array, signal: AbortSignal, onProgress: (n: number) => void): Promise<void> {
	const ab = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
	const res = await platform.blobPut(url, new Blob([ab]), undefined, { signal, onProgress });
	if (!res.ok) {
		throw new Error(`PUT ${res.status}: ${res.statusText}`);
	}
}

interface UploadEnv {
	sender: KeyMaterial;
	recipients: Map<string, RecipientResolution>;
}

async function buildFramedFor(att: Attachment): Promise<Uint8Array> {
	const bytes = new Uint8Array(await att.file.arrayBuffer());
	const plaintextSha = bytesToB64(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)));
	return buildAttFrame(
		{
			filename: att.file.name,
			contentType: att.file.type || 'application/octet-stream',
			disposition: att.disposition,
			contentId: att.contentId,
			plaintextSha256: plaintextSha
		},
		bytes
	);
}

export class UploadOrchestrator {
	private abort = new AbortController();
	private env: UploadEnv | null = null;
	private prepared = new Map<string, Uint8Array>();

	constructor(
		public onChange: (att: Attachment) => void,
		private readonly accountId: string
	) {}

	cancel(): void {
		this.abort.abort();
		this.abort = new AbortController();
		this.prepared.clear();
	}

	async ensureEnv(recipientAddresses: string[]): Promise<UploadEnv> {
		const sender = await senderKey(this.accountId);
		const recipients = this.env?.recipients ?? new Map<string, RecipientResolution>();
		for (const addr of recipientAddresses) {
			if (recipients.has(addr)) continue;
			try {
				recipients.set(addr, await recipientForAddress(addr));
			} catch (e) {
				if (!(e instanceof ApiCallError && e.status === 404)) throw e;
			}
		}
		this.env = { sender, recipients };
		return this.env;
	}

	async ensureRecipientCopies(atts: Attachment[], recipientAddresses: string[]): Promise<void> {
		const ready = atts.filter((a) => a.status === 'ready' && a.senderDescriptor);
		if (ready.length === 0) return;
		const env = await this.ensureEnv(recipientAddresses);
		for (const att of ready) {
			const ordinal = atts.indexOf(att);
			const have = att.recipientDescriptors ?? new Map<string, AttachmentDescriptor>();
			const missing: RecipientResolution[] = [];
			const seen = new Set<string>();
			for (const rec of env.recipients.values()) {
				if (have.has(rec.accountId) || seen.has(rec.accountId)) continue;
				seen.add(rec.accountId);
				missing.push(rec);
			}
			if (missing.length === 0) continue;

			let framed = this.prepared.get(att.id);
			if (!framed) {
				framed = await buildFramedFor(att);
				this.prepared.set(att.id, framed);
			}

			const ciphers: { rec: RecipientResolution; cipher: Uint8Array; sha: string }[] = [];
			for (const rec of missing) {
				const cipher = await encryptToArmored(this.accountId, framed, rec.publicKeyArmored);
				ciphers.push({ rec, cipher, sha: await sha256B64(cipher) });
			}

			const slotReqs: AttachmentUploadSlotRequest[] = ciphers.map((c) => ({
				slotId: crypto.randomUUID(),
				role: 'recipient',
				recipientAccountId: c.rec.accountId,
				ordinal,
				ciphertextSizeBytes: c.cipher.length,
				ciphertextSha256: c.sha,
				keyFingerprint: c.rec.fingerprintB64
			}));
			const grants = await issueAttachmentUploadUrls({ slots: slotReqs });
			const grantBySlot = new Map(grants.slots.map((g) => [g.slotId, g]));

			const next = new Map(have);
			for (let i = 0; i < ciphers.length; i++) {
				const grant = grantBySlot.get(slotReqs[i].slotId);
				if (!grant) throw new SendError('network', 'attachment upload grant missing');
				await putWithProgress(grant.putUrl, ciphers[i].cipher, this.abort.signal, () => {});
				next.set(ciphers[i].rec.accountId, {
					ordinal,
					objectKey: grant.objectKey,
					ciphertextSizeBytes: ciphers[i].cipher.length,
					ciphertextSha256: ciphers[i].sha,
					keyFingerprint: ciphers[i].rec.fingerprintB64
				});
			}
			att.recipientDescriptors = next;
			this.onChange(att);
		}
	}

	async startUpload(att: Attachment, recipientAddresses: string[], ordinal: number): Promise<void> {
		try {
			att.status = 'encrypting';
			att.progress = 0;
			this.onChange(att);

			const env = await this.ensureEnv(recipientAddresses);

			let framed = this.prepared.get(att.id);
			if (!framed) {
				framed = await buildFramedFor(att);
				this.prepared.set(att.id, framed);
			}

			const senderCipher = await encryptToArmored(this.accountId, framed, env.sender.publicKeyArmored);
			const senderSha = await sha256B64(senderCipher);

			const recipientCiphers = new Map<string, { cipher: Uint8Array; sha: string; fp: string }>();
			for (const [, rec] of env.recipients) {
				const cipher = await encryptToArmored(this.accountId, framed, rec.publicKeyArmored);
				const sha = await sha256B64(cipher);
				recipientCiphers.set(rec.accountId, { cipher, sha, fp: rec.fingerprintB64 });
			}

			const slotReqs: AttachmentUploadSlotRequest[] = [
				{
					slotId: crypto.randomUUID(),
					role: 'sender',
					ordinal,
					ciphertextSizeBytes: senderCipher.length,
					ciphertextSha256: senderSha,
					keyFingerprint: env.sender.fingerprintB64
				}
			];
			const recOrder = [...recipientCiphers.keys()];
			for (const accountId of recOrder) {
				const r = recipientCiphers.get(accountId)!;
				slotReqs.push({
					slotId: crypto.randomUUID(),
					role: 'recipient',
					recipientAccountId: accountId,
					ordinal,
					ciphertextSizeBytes: r.cipher.length,
					ciphertextSha256: r.sha,
					keyFingerprint: r.fp
				});
			}

			att.status = 'uploading';
			att.progress = 0;
			this.onChange(att);

			const grants = await issueAttachmentUploadUrls({ slots: slotReqs });
			const grantBySlot = new Map<string, AttachmentUploadGrant>();
			for (const g of grants.slots) grantBySlot.set(g.slotId, g);

			const senderGrant = grantBySlot.get(slotReqs[0].slotId)!;
			let totalSteps = 1 + recOrder.length;
			let stepsDone = 0;
			await putWithProgress(senderGrant.putUrl, senderCipher, this.abort.signal, (p) => {
				att.progress = (stepsDone + p) / totalSteps;
				this.onChange(att);
			});
			stepsDone++;
			att.senderDescriptor = {
				ordinal,
				objectKey: senderGrant.objectKey,
				ciphertextSizeBytes: senderCipher.length,
				ciphertextSha256: senderSha,
				keyFingerprint: env.sender.fingerprintB64
			};

			const recipientDescriptors = new Map<string, AttachmentDescriptor>();
			for (let i = 0; i < recOrder.length; i++) {
				const accountId = recOrder[i];
				const grant = grantBySlot.get(slotReqs[1 + i].slotId)!;
				const r = recipientCiphers.get(accountId)!;
				await putWithProgress(grant.putUrl, r.cipher, this.abort.signal, (p) => {
					att.progress = (stepsDone + p) / totalSteps;
					this.onChange(att);
				});
				stepsDone++;
				recipientDescriptors.set(accountId, {
					ordinal,
					objectKey: grant.objectKey,
					ciphertextSizeBytes: r.cipher.length,
					ciphertextSha256: r.sha,
					keyFingerprint: r.fp
				});
			}
			att.recipientDescriptors = recipientDescriptors;
			att.progress = 1;
			att.status = 'ready';
			this.onChange(att);
		} catch (err) {
			if (err instanceof DOMException && err.name === 'AbortError') {
				att.status = 'cancelled';
				this.onChange(att);
				return;
			}
			att.status = 'error';
			att.error = err instanceof Error ? err.message : String(err);
			this.onChange(att);
		}
	}
}
