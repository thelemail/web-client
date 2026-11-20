const CHANNEL = 'thelemail-handoff-tab';
const TAB_FLAG = 'thelemail-handoff-tab';
const HAND_BACK_MS = 1500;

export interface TabResult {
	accountId: string;
	path: string;
}

type Message = ({ type: 'done'; id: string } & TabResult) | { type: 'taken'; id: string };

let pending: { accountId: string | null } | null = null;

function channel(): BroadcastChannel | null {
	try {
		return new BroadcastChannel(CHANNEL);
	} catch {
		return null;
	}
}

export function openAuthTab(accountId: string | null, route: string): boolean {
	const fragment = new URLSearchParams({ ...(accountId ? { account: accountId } : {}), route, tab: '1' });
	let opened: Window | null = null;
	try {
		opened = window.open(`/auth/start#${fragment.toString()}`, '_blank');
	} catch {
		opened = null;
	}
	pending = opened ? { accountId } : null;
	return opened !== null;
}

export function authTabPendingFor(accountId: string | null): boolean {
	return pending !== null && pending.accountId === accountId;
}

export function markAuthTab(): void {
	try {
		sessionStorage.setItem(TAB_FLAG, '1');
	} catch {
		return;
	}
}

export function inAuthTab(): boolean {
	try {
		return sessionStorage.getItem(TAB_FLAG) === '1';
	} catch {
		return false;
	}
}

export function leaveAuthTab(): void {
	try {
		sessionStorage.removeItem(TAB_FLAG);
	} catch {
		return;
	}
}

export function handBack(result: TabResult): Promise<boolean> {
	const ch = channel();
	if (!ch) return Promise.resolve(false);
	const id = crypto.randomUUID();
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			ch.close();
			resolve(false);
		}, HAND_BACK_MS);
		ch.onmessage = (e: MessageEvent<Message>) => {
			if (e.data?.type !== 'taken' || e.data.id !== id) return;
			clearTimeout(timer);
			ch.close();
			resolve(true);
		};
		ch.postMessage({ type: 'done', id, ...result } satisfies Message);
	});
}

export function awaitAuthTab(accountId: string | null, done: (result: TabResult) => void): () => void {
	const ch = channel();
	if (!ch) return () => undefined;
	ch.onmessage = (e: MessageEvent<Message>) => {
		const msg = e.data;
		if (msg?.type !== 'done' || typeof msg.accountId !== 'string' || (accountId !== null && msg.accountId !== accountId) || typeof msg.path !== 'string' || !/^\/u\/\d+(\/|$)/.test(msg.path)) return;
		ch.postMessage({ type: 'taken', id: msg.id } satisfies Message);
		if (pending?.accountId === accountId) pending = null;
		done({ accountId: msg.accountId, path: msg.path });
	};
	return () => ch.close();
}
