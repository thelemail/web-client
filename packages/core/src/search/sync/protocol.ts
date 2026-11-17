import type { FetchedArtifact } from '../../api/searchSync';
import type {
	BlobPointer,
	SearchArtifactKey,
	SearchArtifactPage,
	SearchArtifactUploadItem,
	SearchArtifactUploadResponse,
	SearchSourceBarrier,
	SearchSourceChangesPage,
	SearchSourceDescriptorRequestItem,
	SearchSourceDescriptorResponse,
	SearchSourceSnapshotPage
} from '../../api/types';

export type FailureReason = 'ciphertext' | 'unavailable' | 'malformed' | 'unknown';

export type BridgeFailure =
	| { code: 'pending'; retryAfterSeconds: number }
	| { code: 'retry'; retryAfterSeconds: number | null }
	| { code: 'expired'; minRetainedSeq: number | null; committedSeq: number | null }
	| { code: 'locked' }
	| { code: 'vault_locked' }
	| { code: 'gone' }
	| { code: 'changed' }
	| { code: 'generation' }
	| { code: 'full' }
	| { code: 'failed'; reason: FailureReason };

export type BridgeResult<T> = { ok: true; value: T } | { ok: false; failure: BridgeFailure };

export interface BodyValue {
	storedBytes: number;
	mime: Uint8Array;
}

export interface DraftValue {
	storedBytes: number;
	json: Uint8Array;
	updatedAt: string;
}

export interface AttachmentValue {
	filename: string;
	contentType: string;
	inline: boolean;
	size: number;
}

export interface FileValue {
	bytes: Uint8Array;
	filename: string;
	contentType: string;
}

export type BridgeRequest =
	| { op: 'barrier' }
	| { op: 'snapshot'; cursor: string | null }
	| { op: 'changes'; afterSeq: number; throughSeq?: number }
	| { op: 'describe'; items: SearchSourceDescriptorRequestItem[] }
	| { op: 'preview'; data: string; keyFingerprint?: string }
	| { op: 'body'; pointer: BlobPointer }
	| { op: 'draft'; draftId: string; pointer: BlobPointer }
	| { op: 'attachment'; pointer: BlobPointer }
	| { op: 'attachmentBytes'; pointer: BlobPointer }
	| { op: 'draftAttachment'; draftId: string; bundle: BlobPointer; index: number }
	| { op: 'artifactList'; generationId: string; afterSeq: number; limit: number }
	| { op: 'artifactFetch'; generationId: string; keys: SearchArtifactKey[] }
	| { op: 'artifactUpload'; generationId: string; items: { item: SearchArtifactUploadItem; bytes: Uint8Array }[] };

export interface BridgeValues {
	barrier: SearchSourceBarrier;
	snapshot: SearchSourceSnapshotPage;
	changes: SearchSourceChangesPage;
	describe: SearchSourceDescriptorResponse;
	preview: string;
	body: BodyValue;
	draft: DraftValue;
	attachment: AttachmentValue;
	attachmentBytes: FileValue;
	draftAttachment: FileValue;
	artifactList: SearchArtifactPage;
	artifactFetch: FetchedArtifact[];
	artifactUpload: SearchArtifactUploadResponse;
}

export type BridgeMessage = BridgeRequest & { id: number };

export interface BridgeReply {
	id: number;
	result: BridgeResult<unknown>;
}
