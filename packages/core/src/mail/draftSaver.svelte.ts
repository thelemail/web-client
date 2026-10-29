import { putDraft } from '$core/api/drafts';
import type { DraftAttachmentsChange } from '$core/api/types';
import type { AttDisposition } from './attframe';
import {
	buildDraftEnvelope,
	packDraftBundle,
	uploadDraftBundle,
	type DraftAttachmentMeta,
	type DraftDoc
} from './draft';

export interface SavedAttachment {
	id: string;
	file: File;
	disposition: AttDisposition;
	contentId?: string;
}

export interface DraftSource {
	allowed(): boolean;
	key(): string;
	worth(): boolean;
	attachments(): SavedAttachment[];
	doc(metas: DraftAttachmentMeta[]): DraftDoc;
	saved?(id: string, doc: DraftDoc): void;
}

export function attachmentSig(list: SavedAttachment[]): string {
	return list.map((a) => `${a.id}:${a.disposition}:${a.contentId ?? ''}`).join('|');
}

export class DraftSaver {
	readonly accountId: string;
	id = $state<string | null>(null);
	saving = $state(false);
	failed = $state(false);
	lastKey = $state('');

	#source: DraftSource;
	#delayMs: number;
	#bundled: { sig: string; metas: DraftAttachmentMeta[] } = { sig: '', metas: [] };
	#inflight: Promise<void> | null = null;
	#again = false;
	#timer: ReturnType<typeof setTimeout> | undefined;

	constructor(accountId: string, source: DraftSource, id: string | null = null, delayMs = 1500) {
		this.accountId = accountId;
		this.#source = source;
		this.id = id;
		this.#delayMs = delayMs;
	}

	get persisted(): boolean {
		return this.id !== null && this.lastKey !== '';
	}

	baseline(key: string, attachments: SavedAttachment[], metas: DraftAttachmentMeta[]): void {
		this.lastKey = key;
		this.#bundled = { sig: attachmentSig(attachments), metas };
	}

	keepUnrestored(metas: DraftAttachmentMeta[]): void {
		this.#bundled = { sig: '', metas };
	}

	schedule(): void {
		clearTimeout(this.#timer);
		this.#timer = setTimeout(() => void this.save(), this.#delayMs);
	}

	cancel(): void {
		clearTimeout(this.#timer);
	}

	save(): Promise<void> {
		if (this.#inflight) {
			this.#again = true;
			return this.#inflight;
		}
		this.#inflight = this.#persist().finally(() => {
			this.#inflight = null;
			if (this.#again) {
				this.#again = false;
				void this.save();
			}
		});
		return this.#inflight;
	}

	async settle(): Promise<void> {
		this.cancel();
		await this.save();
		while (this.#inflight) await this.#inflight;
	}

	release(): string | null {
		this.cancel();
		const id = this.id;
		this.id = null;
		return id;
	}

	async #persist(): Promise<void> {
		const src = this.#source;
		if (!src.allowed()) return;
		const key = src.key();
		if (key === this.lastKey) return;
		const snapshot = src.attachments();
		if (!this.id && snapshot.length === 0 && !src.worth()) return;
		const id = this.id ?? crypto.randomUUID();
		this.id = id;
		this.saving = true;
		try {
			const sig = attachmentSig(snapshot);
			let metas = this.#bundled.metas;
			let change: DraftAttachmentsChange | undefined;
			if (sig !== this.#bundled.sig) {
				if (snapshot.length === 0) {
					metas = [];
					change = { action: 'clear' };
				} else {
					const packed = await packDraftBundle(
						this.accountId,
						snapshot.map((a) => ({ file: a.file, disposition: a.disposition, contentId: a.contentId }))
					);
					const uploadId = await uploadDraftBundle(id, packed);
					metas = packed.metas;
					change = { action: 'replace', uploadId, count: metas.length };
				}
			}
			const doc = src.doc(metas);
			await putDraft(id, await buildDraftEnvelope(this.accountId, doc, change));
			this.#bundled = { sig, metas };
			this.lastKey = key;
			this.failed = false;
			src.saved?.(id, doc);
		} catch {
			this.failed = true;
		} finally {
			this.saving = false;
		}
	}
}
