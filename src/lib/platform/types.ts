export type Transport = (url: string, init: RequestInit) => Promise<Response>;

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

export interface LocalMirror {
	open(accountId: string): Promise<void>;
	close(accountId: string): Promise<void>;
	startSync(accountId: string, accessToken: string): Promise<void>;
	search(accountId: string, query: string, limit?: number): Promise<SearchHit[]>;
}

export interface Platform {
	mirror?: LocalMirror;
	keystoreChannel?: KeystoreChannel;
	transport?: Transport;
	openEventSource?: (url: string) => EventSourceLike;
	blobFetch: (url: string, init?: RequestInit) => Promise<Response>;
	returnOrigin: () => string;
	openExternal: (url: string) => void;
	saveBlob: (blob: Blob, filename: string) => Promise<void>;
}
