import { PUBLIC_API_BASE_URL } from '$env/static/public';
import { mintRealtimeTicket, type RealtimeTicketResponse } from '$lib/api/realtime';
import { nextDelay } from './backoff';
import type { ConnectionState, RealtimeHint, WireHint } from './types';

export interface EventSourceLike {
	close(): void;
	onopen: ((ev: Event) => void) | null;
	onerror: ((ev: Event) => void) | null;
	onmessage: ((ev: MessageEvent) => void) | null;
}

export interface ConnectionOptions {
	accountId: string;
	onHint: (hint: RealtimeHint) => void;
	onState?: (state: ConnectionState, downMs: number) => void;
	open?: (url: string) => EventSourceLike;
	mint?: (accountId: string) => Promise<RealtimeTicketResponse>;
}

function defaultOpen(url: string): EventSourceLike {
	return new EventSource(url) as unknown as EventSourceLike;
}

export class RealtimeConnection {
	#opts: ConnectionOptions;
	#es: EventSourceLike | null = null;
	#state: ConnectionState = 'idle';
	#attempt = 0;
	#lastEventId: string | null = null;
	#reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	#stopped = false;
	#connectSeq = 0;
	#closedAt: number | null = null;

	constructor(opts: ConnectionOptions) {
		this.#opts = opts;
	}

	get state(): ConnectionState {
		return this.#state;
	}

	get lastEventId(): string | null {
		return this.#lastEventId;
	}

	start(): void {
		if (this.#stopped) return;
		if (this.#state === 'connecting' || this.#state === 'open') return;
		this.#clearReconnectTimer();
		void this.#connect();
	}

	stop(): void {
		this.#stopped = true;
		this.#clearReconnectTimer();
		this.#es?.close();
		this.#es = null;
		this.#setState('stopped');
	}

	kick(): void {
		if (this.#stopped) return;
		if (this.#state === 'reconnecting') {
			this.#clearReconnectTimer();
			void this.#connect();
		}
	}

	#setState(state: ConnectionState): void {
		this.#state = state;
		const downMs = this.#closedAt !== null ? Date.now() - this.#closedAt : 0;
		this.#opts.onState?.(state, downMs);
	}

	#clearReconnectTimer(): void {
		if (this.#reconnectTimer !== null) {
			clearTimeout(this.#reconnectTimer);
			this.#reconnectTimer = null;
		}
	}

	async #connect(): Promise<void> {
		const seq = ++this.#connectSeq;
		this.#setState('connecting');

		const mint = this.#opts.mint ?? mintRealtimeTicket;
		let ticket: RealtimeTicketResponse;
		try {
			ticket = await mint(this.#opts.accountId);
		} catch (err) {
			if (this.#stopped || seq !== this.#connectSeq) return;
			if (isNotFound(err)) {
				this.#stopped = true;
				this.#setState('stopped');
				return;
			}
			this.#scheduleReconnect();
			return;
		}
		if (this.#stopped || seq !== this.#connectSeq) return;

		const url = new URL('/v1/realtime/stream', PUBLIC_API_BASE_URL);
		url.searchParams.set('ticket', ticket.ticket);
		if (this.#lastEventId) url.searchParams.set('since', this.#lastEventId);

		const open = this.#opts.open ?? defaultOpen;
		const es = open(url.toString());
		this.#es = es;

		es.onopen = () => {
			if (seq !== this.#connectSeq) return;
			this.#attempt = 0;
			this.#closedAt = null;
			this.#setState('open');
		};

		es.onerror = () => {
			es.close();
			if (seq !== this.#connectSeq) return;
			if (this.#es === es) this.#es = null;
			this.#closedAt = Date.now();
			if (this.#stopped) return;
			this.#scheduleReconnect();
		};

		es.onmessage = (ev: MessageEvent) => {
			if (seq !== this.#connectSeq) return;
			if (ev.lastEventId) this.#lastEventId = ev.lastEventId;
			let hint: WireHint;
			try {
				hint = JSON.parse(ev.data);
			} catch {
				return;
			}
			if (!hint.kind) return;
			this.#opts.onHint({ ...hint, accountId: this.#opts.accountId });
		};
	}

	#scheduleReconnect(): void {
		this.#setState('reconnecting');
		const delay = nextDelay(this.#attempt++);
		this.#reconnectTimer = setTimeout(() => {
			this.#reconnectTimer = null;
			void this.#connect();
		}, delay);
	}
}

function isNotFound(err: unknown): boolean {
	return typeof err === 'object' && err !== null && 'status' in err && (err as { status: unknown }).status === 404;
}
