import { m } from '$paraglide/messages.js';
import type { Attachment } from './attachmentUpload';

export type SendBlock =
	| { kind: 'no-sender' }
	| { kind: 'from'; address: string }
	| { kind: 'attachment-failed'; id: string; name: string }
	| { kind: 'attachment-pending'; id: string; name: string };

type Tracked = Pick<Attachment, 'id' | 'file' | 'status'>;

export interface SendBlockFacts {
	noSender: boolean;
	revokedFrom: string | null;
	attachments: Tracked[];
}

const PENDING = new Set<Attachment['status']>(['queued', 'encrypting', 'uploading']);
const FAILED = new Set<Attachment['status']>(['error', 'cancelled']);

export function sendBlock(f: SendBlockFacts): SendBlock | null {
	if (f.noSender) return { kind: 'no-sender' };
	if (f.revokedFrom) return { kind: 'from', address: f.revokedFrom };
	const failed = f.attachments.find((a) => FAILED.has(a.status));
	if (failed) return { kind: 'attachment-failed', id: failed.id, name: failed.file.name };
	const pending = f.attachments.find((a) => PENDING.has(a.status));
	if (pending) return { kind: 'attachment-pending', id: pending.id, name: pending.file.name };
	return null;
}

export function sendBlockText(b: SendBlock): string {
	if (b.kind === 'no-sender') return m.mail_compose_no_sender();
	if (b.kind === 'from') return m.mail_compose_block_from();
	if (b.kind === 'attachment-failed') return m.mail_compose_block_att_failed({ name: b.name });
	return m.mail_compose_block_att_pending({ name: b.name });
}

export function attachmentStatusText(list: Tracked[]): string | null {
	const failed = list.find((a) => FAILED.has(a.status));
	if (failed) return m.mail_compose_status_att_failed({ name: failed.file.name });
	const pending = list.filter((a) => PENDING.has(a.status)).length;
	return pending > 0 ? m.mail_compose_status_att_pending({ count: pending }) : null;
}

export function dockAttention(b: SendBlock | null): string | null {
	if (!b) return null;
	if (b.kind === 'from' || b.kind === 'no-sender') return m.mail_compose_dock_from();
	if (b.kind === 'attachment-failed') return m.mail_compose_dock_att_failed();
	return null;
}
