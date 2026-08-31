export type TransportKind = 'api' | 'submission';

export type Transport = (
	url: string,
	init: RequestInit,
	kind: TransportKind
) => Promise<Response>;

export interface EventSourceLike {
	close(): void;
	onopen: ((ev: Event) => void) | null;
	onerror: ((ev: Event) => void) | null;
	onmessage: ((ev: MessageEvent) => void) | null;
}

export interface KeystoreChannel<B = unknown> {
	call<T>(cmd: string, args?: unknown, timeoutMs?: number): Promise<T>;
	subscribe(cb: (b: B) => void): () => void;
}

export interface SearchHit {
	id: string;
	subject: string;
	senderDisplay: string;
	senderAddress: string;
	snippet: string;
	excerpt: string;
	storedAt: string;
	mailboxState: string;
	read: boolean;
	starred: boolean;
	attachmentCount: number;
	threadRootId: string | null;
}

export interface MirrorRow {
	id: string;
	direction: 'sent' | 'received';
	mailboxState: string;
	subject: string;
	senderDisplay: string;
	senderAddress: string;
	recipientsJson: string;
	snippet: string;
	displayDate: string;
	storedAt: string;
	read: boolean;
	starred: boolean;
	attachmentCount: number;
	threadRootId: string | null;
	labelsJson: string;
}

export interface MirrorAttachment {
	id: string;
	ordinal: number;
	filename: string;
	contentType: string;
	disposition: string;
	contentId: string | null;
	plaintextSize: number;
	isInline: boolean;
}

export interface MirrorMessage {
	id: string;
	direction: 'sent' | 'received';
	source: string;
	mailboxState: string;
	storedAt: string;
	read: boolean;
	starred: boolean;
	threadRootId: string | null;
	externalMessageId: string | null;
	inReplyTo: string | null;
	labelsJson: string;
	signatureStatus: string | null;
	subject: string;
	senderDisplay: string;
	senderAddress: string;
	recipientsJson: string;
	snippet: string;
	displayDate: string;
	attachmentCount: number;
	mime: string | null;
	attachments: MirrorAttachment[];
}

export interface LocalMirror {
	open(accountId: string): Promise<void>;
	close(accountId: string): Promise<void>;
	startSync(accountId: string, accessToken: string): Promise<void>;
	setToken(accountId: string, accessToken: string): Promise<void>;
	stopWatch(accountId: string): Promise<void>;
	search(accountId: string, query: string, limit?: number): Promise<SearchHit[]>;
	list(accountId: string, mailbox: string, limit?: number): Promise<MirrorRow[]>;
	message(accountId: string, messageId: string): Promise<MirrorMessage | null>;
	thread(accountId: string, messageId: string): Promise<MirrorMessage[]>;
	scope(accountId: string): Promise<string | null>;
	setScope(accountId: string, dateFloor: string | null): Promise<void>;
	onChanged?(cb: (accountId: string) => void): () => void;
}

export type BillingMode = 'native' | 'handoff';

export interface NativeSession {
	persist(accountId: string): Promise<boolean>;
	restore(accountId: string): Promise<boolean>;
	forget(accountId: string): Promise<void>;
}

export interface Platform {
	reportError?: (kind: string, err: unknown) => void;
	interceptFrameLinks?: boolean;
	session?: NativeSession;
	billing: BillingMode;
	mirror?: LocalMirror;
	keystoreChannel?: KeystoreChannel;
	transport?: Transport;
	openEventSource?: (url: string) => EventSourceLike;
	blobFetch: (url: string, init?: RequestInit) => Promise<Response>;
	blobPut: (url: string, body: Blob, contentType?: string) => Promise<Response>;
	returnOrigin: () => string;
	openExternal: (url: string) => void;
	saveBlob: (blob: Blob, filename: string) => Promise<void>;
}
