export type CalendarChannelMessage =
	| { type: 'changed'; accountId: string }
	| { type: 'queue'; accountId: string };

const NAME = 'thelemail:calendar';

let channel: BroadcastChannel | null = null;

function get(): BroadcastChannel | null {
	if (typeof BroadcastChannel === 'undefined') return null;
	channel ??= new BroadcastChannel(NAME);
	return channel;
}

export function postCalendarMessage(message: CalendarChannelMessage): void {
	get()?.postMessage(message);
}

export function onCalendarMessage(cb: (message: CalendarChannelMessage) => void): () => void {
	const ch = get();
	if (!ch) return () => {};
	const handler = (ev: MessageEvent<CalendarChannelMessage>) => cb(ev.data);
	ch.addEventListener('message', handler);
	return () => ch.removeEventListener('message', handler);
}
