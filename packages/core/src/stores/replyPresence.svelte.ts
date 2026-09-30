import { getReplyPresence, startReplyPresence, stopReplyPresence } from '$core/api/messages';
import { ApiCallError, type ReplyPresenceEntry } from '$core/api/types';
import type { RealtimeHint } from '$core/realtime/types';

const HEARTBEAT_MS = 20_000;
const EXPIRY_SLACK_MS = 250;
const MIN_RECHECK_MS = 1_000;

interface Watch {
	messageId: string;
	threadId: string | null;
	timer: ReturnType<typeof setTimeout> | null;
}

class ReplyPresenceStore {
	replying = $state<ReplyPresenceEntry[]>([]);
	#watch: Watch | null = null;
	#seq = 0;

	watch(messageId: string, threadId: string | null): () => void {
		this.#stop();
		const w: Watch = { messageId, threadId, timer: null };
		this.#watch = w;
		void this.#fetch(w);
		return () => {
			if (this.#watch === w) this.#stop();
		};
	}

	onHint(hint: RealtimeHint): void {
		const w = this.#watch;
		if (!w) return;
		const sameThread = !hint.thread_id || !w.threadId || hint.thread_id === w.threadId;
		if (!sameThread && hint.id !== w.messageId) return;
		void this.#fetch(w);
	}

	async #fetch(w: Watch): Promise<void> {
		const seq = ++this.#seq;
		try {
			const { replying } = await getReplyPresence(w.messageId);
			if (this.#watch !== w || seq !== this.#seq) return;
			this.replying = replying;
			this.#schedule(w, replying);
		} catch {
			if (this.#watch !== w || seq !== this.#seq) return;
			this.replying = [];
		}
	}

	#schedule(w: Watch, replying: ReplyPresenceEntry[]): void {
		if (w.timer) clearTimeout(w.timer);
		w.timer = null;
		if (!replying.length) return;
		const nextExpiry = Math.min(...replying.map((e) => Date.parse(e.expiresAt)));
		const wait = Math.max(MIN_RECHECK_MS, nextExpiry - Date.now() + EXPIRY_SLACK_MS);
		w.timer = setTimeout(() => void this.#fetch(w), wait);
	}

	#stop(): void {
		if (this.#watch?.timer) clearTimeout(this.#watch.timer);
		this.#watch = null;
		this.#seq++;
		this.replying = [];
	}
}

export const replyPresence = new ReplyPresenceStore();

export function announceReplying(messageId: string): () => void {
	let stopped = false;
	let announced = false;
	const beat = async () => {
		try {
			await startReplyPresence(messageId);
			announced = true;
		} catch (e) {
			if (e instanceof ApiCallError && (e.status === 400 || e.status === 404)) end(false);
		}
	};
	const onPageHide = () => {
		if (announced) void stopReplyPresence(messageId, { keepalive: true }).catch(() => {});
	};
	const timer = setInterval(() => void beat(), HEARTBEAT_MS);
	window.addEventListener('pagehide', onPageHide);
	void beat();

	function end(clear: boolean): void {
		if (stopped) return;
		stopped = true;
		clearInterval(timer);
		window.removeEventListener('pagehide', onPageHide);
		if (clear && announced) void stopReplyPresence(messageId).catch(() => {});
	}

	return () => end(true);
}
