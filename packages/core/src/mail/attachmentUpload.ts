import { apiBlobPut } from '$core/api/client';
import { bytesToB64 } from '$core/crypto';
import { issueAttachmentUploadUrls } from '$core/api/messages';
import { build as buildAttFrame } from '$core/mail/attframe';
import {
	encryptTo,
	resolveRecipient,
	senderKey,
	sha256B64,
	SendError,
	type AcceptedKeys,
	type KeyMaterial
} from './send';
import {
	ApiCallError,
	type AttachmentDescriptor,
	type AttachmentUploadGrant,
	type AttachmentUploadSlotRequest
} from '$core/api/types';

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

export type UploadFailure = 'transient' | 'refused';

export interface Attachment {
	id: string;
	file: File;
	status: AttachmentStatus;
	progress: number;
	error?: string;
	failure?: UploadFailure;
	retrying?: boolean;
	senderDescriptor?: AttachmentDescriptor;
	recipientDescriptors?: Map<string, AttachmentDescriptor>;
	disposition: 'attachment' | 'inline';
	contentId?: string;
	cancelled?: boolean;
}

interface RecipientResolution {
	accountId: string;
	key: KeyMaterial;
}

interface EnvOptions {
	acceptedKeys?: AcceptedKeys;
	strict?: boolean;
}

const UNVERIFIED = new Set(['tofu', 'directory_verification_failed']);
const TRANSIENT_STATUS = new Set([401, 408, 409, 425, 429]);

export function uploadFailure(err: unknown): UploadFailure {
	if (err instanceof ApiCallError && err.status >= 400 && err.status < 500 && !TRANSIENT_STATUS.has(err.status)) {
		return 'refused';
	}
	return 'transient';
}

function isAbort(err: unknown): boolean {
	return err instanceof DOMException && err.name === 'AbortError';
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) return reject(new DOMException('aborted', 'AbortError'));
		const t = setTimeout(() => {
			signal.removeEventListener('abort', stop);
			resolve();
		}, ms);
		const stop = () => {
			clearTimeout(t);
			reject(new DOMException('aborted', 'AbortError'));
		};
		signal.addEventListener('abort', stop, { once: true });
	});
}

async function putWithProgress(grant: AttachmentUploadGrant, body: Uint8Array, signal: AbortSignal, onProgress: (n: number) => void): Promise<void> {
	const ab = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
	await apiBlobPut(grant.putPath, new Blob([ab]), { signal, onProgress });
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
	autoRetries = 1;
	retryDelayMs = 1500;

	constructor(
		public onChange: (att: Attachment) => void,
		private readonly accountId: string
	) {}

	cancel(): void {
		this.abort.abort();
		this.abort = new AbortController();
		this.prepared.clear();
	}

	private async ensureEnv(recipientAddresses: string[], opts: EnvOptions = {}): Promise<UploadEnv> {
		const sender = await senderKey(this.accountId);
		const recipients =
			(!opts.strict && this.env?.recipients) || new Map<string, RecipientResolution>();
		for (const addr of recipientAddresses) {
			if (recipients.has(addr)) continue;
			try {
				const r = await resolveRecipient(addr, { acceptedKeys: opts.acceptedKeys });
				recipients.set(addr, { accountId: r.accountId, key: r.key });
			} catch (e) {
				if (!(e instanceof SendError)) throw e;
				if (e.code === 'recipient_unknown') continue;
				if (!opts.strict && UNVERIFIED.has(e.code)) continue;
				throw e;
			}
		}
		this.env = { sender, recipients };
		return this.env;
	}

	async ensureRecipientCopies(
		atts: Attachment[],
		recipientAddresses: string[],
		opts: { acceptedKeys?: AcceptedKeys } = {}
	): Promise<void> {
		const ready = atts.filter((a) => a.status === 'ready' && a.senderDescriptor);
		if (ready.length === 0) return;
		const env = await this.ensureEnv(recipientAddresses, { ...opts, strict: true });
		for (const att of ready) {
			const ordinal = atts.indexOf(att);
			const have = att.recipientDescriptors ?? new Map<string, AttachmentDescriptor>();
			const missing: RecipientResolution[] = [];
			const seen = new Set<string>();
			for (const rec of env.recipients.values()) {
				if (seen.has(rec.accountId)) continue;
				if (have.get(rec.accountId)?.keyFingerprint === rec.key.fingerprintB64) continue;
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
				const cipher = await encryptTo(this.accountId, framed, rec.key.publicKeyArmored);
				ciphers.push({ rec, cipher, sha: await sha256B64(cipher) });
			}

			const slotReqs: AttachmentUploadSlotRequest[] = ciphers.map((c) => ({
				slotId: crypto.randomUUID(),
				role: 'recipient',
				recipientAccountId: c.rec.accountId,
				ordinal,
				ciphertextSizeBytes: c.cipher.length,
				ciphertextSha256: c.sha,
				keyFingerprint: c.rec.key.fingerprintB64
			}));
			const grants = await issueAttachmentUploadUrls({ slots: slotReqs });
			const grantBySlot = new Map(grants.slots.map((g) => [g.slotId, g]));

			const next = new Map(have);
			for (let i = 0; i < ciphers.length; i++) {
				const grant = grantBySlot.get(slotReqs[i].slotId);
				if (!grant) throw new SendError('network', 'attachment upload grant missing');
				await putWithProgress(grant, ciphers[i].cipher, this.abort.signal, () => {});
				next.set(ciphers[i].rec.accountId, {
					ordinal,
					objectKey: grant.objectKey,
					ciphertextSizeBytes: ciphers[i].cipher.length,
					ciphertextSha256: ciphers[i].sha,
					keyFingerprint: ciphers[i].rec.key.fingerprintB64
				});
			}
			att.recipientDescriptors = next;
			this.onChange(att);
		}
	}

	async startUpload(att: Attachment, recipientAddresses: string[], ordinal: number): Promise<void> {
		const signal = this.abort.signal;
		for (let attempt = 0; ; attempt++) {
			try {
				await this.upload(att, recipientAddresses, ordinal);
				return;
			} catch (err) {
				if (isAbort(err)) {
					this.settleCancelled(att);
					return;
				}
				const failure = uploadFailure(err);
				if (failure === 'transient' && attempt < this.autoRetries) {
					att.retrying = true;
					this.onChange(att);
					try {
						await wait(this.retryDelayMs, signal);
					} catch {
						this.settleCancelled(att);
						return;
					}
					continue;
				}
				att.status = 'error';
				att.retrying = false;
				att.failure = failure;
				att.error = err instanceof Error ? err.message : String(err);
				this.onChange(att);
				return;
			}
		}
	}

	private settleCancelled(att: Attachment): void {
		att.status = 'cancelled';
		att.retrying = false;
		this.onChange(att);
	}

	private async upload(att: Attachment, recipientAddresses: string[], ordinal: number): Promise<void> {
		att.status = 'encrypting';
		att.progress = 0;
		att.error = undefined;
		att.failure = undefined;
		att.senderDescriptor = undefined;
		att.recipientDescriptors = undefined;
		this.onChange(att);

		const env = await this.ensureEnv(recipientAddresses);

		let framed = this.prepared.get(att.id);
		if (!framed) {
			framed = await buildFramedFor(att);
			this.prepared.set(att.id, framed);
		}

		const senderCipher = await encryptTo(this.accountId, framed, env.sender.publicKeyArmored);
		const senderSha = await sha256B64(senderCipher);

		const recipientCiphers = new Map<string, { cipher: Uint8Array; sha: string; fp: string }>();
		for (const [, rec] of env.recipients) {
			if (recipientCiphers.has(rec.accountId)) continue;
			const cipher = await encryptTo(this.accountId, framed, rec.key.publicKeyArmored);
			const sha = await sha256B64(cipher);
			recipientCiphers.set(rec.accountId, { cipher, sha, fp: rec.key.fingerprintB64 });
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
		await putWithProgress(senderGrant, senderCipher, this.abort.signal, (p) => {
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
			await putWithProgress(grant, r.cipher, this.abort.signal, (p) => {
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
		att.retrying = false;
		this.onChange(att);
	}
}
