import type { Message } from './data';

export interface StickyRow {
	id: string;
	index: number;
	msg: Message;
}

export function trackOpenRow(rows: Message[], openId: string | null, prev: StickyRow | null): StickyRow | null {
	if (!openId) return null;
	const index = rows.findIndex((m) => m.id === openId);
	if (index >= 0) return { id: openId, index, msg: rows[index] };
	return prev?.id === openId ? prev : null;
}

export function withOpenRow(
	rows: Message[],
	sticky: StickyRow | null,
	openId: string | null,
	latest: (id: string) => Message | null
): Message[] {
	if (!sticky || sticky.id !== openId || rows.some((m) => m.id === sticky.id)) return rows;
	const out = rows.slice();
	out.splice(Math.min(sticky.index, out.length), 0, latest(sticky.id) ?? sticky.msg);
	return out;
}
