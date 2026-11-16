import { backoffDelay } from '../sync/backoff';
import { CONNECT, type ConnectMessage, type ControlEvent, type JobOutcome, type JobTicket } from './protocol';

const READY_TIMEOUT_MS = 30_000;

export interface ParserHostOptions {
	origin: string;
	document?: Document;
	readyTimeoutMs?: number;
	now?: () => number;
}

function nonce(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(24));
	return btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}

function refuse(ticket: JobTicket, port: MessagePort): void {
	port.postMessage({ jobId: ticket.jobId, ok: false, reason: 'unavailable' } satisfies JobOutcome);
	port.close();
}

export class ParserHost {
	#origin: string;
	#document: Document;
	#readyTimeoutMs: number;
	#now: () => number;
	#frame: HTMLIFrameElement | null = null;
	#control: Promise<MessagePort | null> | null = null;
	#failures = 0;
	#retryAt = 0;
	#clients = new Set<MessagePort>();
	#closed = false;

	constructor(options: ParserHostOptions) {
		this.#origin = new URL(options.origin).origin;
		this.#document = options.document ?? document;
		this.#readyTimeoutMs = options.readyTimeoutMs ?? READY_TIMEOUT_MS;
		this.#now = options.now ?? Date.now;
	}

	connect(): MessagePort {
		const channel = new MessageChannel();
		const port = channel.port1;
		this.#clients.add(port);
		port.onmessage = (e: MessageEvent<JobTicket>) => {
			const job = e.ports[0];
			if (!job || e.data?.type !== 'job') return;
			void this.#forward(e.data, job);
		};
		port.start();
		return channel.port2;
	}

	close(): void {
		this.#closed = true;
		for (const port of this.#clients) port.close();
		this.#clients.clear();
		this.#teardown();
	}

	async #forward(ticket: JobTicket, job: MessagePort): Promise<void> {
		const control = await this.#ensure();
		if (!control || this.#closed) return refuse(ticket, job);
		control.postMessage(ticket, [job]);
	}

	#ensure(): Promise<MessagePort | null> {
		if (this.#control) return this.#control;
		if (this.#closed || this.#now() < this.#retryAt) return Promise.resolve(null);
		const attempt = this.#mount();
		this.#control = attempt;
		void attempt.then((port) => {
			if (port) {
				this.#failures = 0;
				return;
			}
			this.#retryAt = this.#now() + backoffDelay(this.#failures++, null);
			if (this.#control === attempt) this.#control = null;
			this.#teardown();
		});
		return attempt;
	}

	#mount(): Promise<MessagePort | null> {
		const secret = nonce();
		const frame = this.#document.createElement('iframe');
		frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
		frame.setAttribute('allow', '');
		frame.setAttribute('credentialless', '');
		frame.setAttribute('referrerpolicy', 'no-referrer');
		frame.setAttribute('loading', 'eager');
		frame.setAttribute('aria-hidden', 'true');
		frame.setAttribute('tabindex', '-1');
		frame.title = 'parser';
		frame.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden;pointer-events:none';
		frame.src = `${this.#origin}/#n=${secret}`;
		this.#frame = frame;
		return new Promise((resolve) => {
			const channel = new MessageChannel();
			const finish = (port: MessagePort | null) => {
				clearTimeout(timer);
				frame.removeEventListener('load', onLoad);
				channel.port1.onmessage = null;
				if (!port) channel.port1.close();
				resolve(port);
			};
			const timer = setTimeout(() => finish(null), this.#readyTimeoutMs);
			channel.port1.onmessage = (e: MessageEvent<ControlEvent>) => {
				if (e.data?.type === 'ready') finish(channel.port1);
				else finish(null);
			};
			const onLoad = () => {
				const target = frame.contentWindow;
				if (!target) return finish(null);
				target.postMessage({ type: CONNECT, nonce: secret } satisfies ConnectMessage, this.#origin, [channel.port2]);
			};
			frame.addEventListener('load', onLoad, { once: true });
			this.#document.body.appendChild(frame);
		});
	}

	#teardown(): void {
		this.#frame?.remove();
		this.#frame = null;
		const control = this.#control;
		this.#control = null;
		void control?.then((port) => port?.close());
	}
}
