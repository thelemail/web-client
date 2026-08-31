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

export interface Platform {
	keystoreChannel?: KeystoreChannel;
	transport?: Transport;
	openEventSource?: (url: string) => EventSourceLike;
	blobFetch: (url: string, init?: RequestInit) => Promise<Response>;
	returnOrigin: () => string;
	openExternal: (url: string) => void;
	saveBlob: (blob: Blob, filename: string) => Promise<void>;
}
