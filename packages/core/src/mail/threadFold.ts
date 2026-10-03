import type { ThreadEntry } from './data';

export type FoldRow = { kind: 'entry'; index: number } | { kind: 'fold'; start: number; count: number };

const FOLD_ABOVE = 4;
const TAIL = 3;

function alwaysShown(n: number): Set<number> {
	if (n <= FOLD_ABOVE) return new Set(Array.from({ length: n }, (_, i) => i));
	const out = new Set<number>([0]);
	for (let i = Math.max(1, n - TAIL); i < n; i++) out.add(i);
	return out;
}

export function focusIdOf(entries: ThreadEntry[], preferred?: string | null): string | undefined {
	if (preferred && entries.some((e) => e.id === preferred)) return preferred;
	return entries.at(-1)?.id;
}

export function initialOpenIds(entries: ThreadEntry[], focusId?: string): string[] {
	const shown = alwaysShown(entries.length);
	const ids = new Set<string>();
	if (focusId) ids.add(focusId);
	const last = entries.at(-1)?.id;
	if (last) ids.add(last);
	entries.forEach((e, i) => {
		if (e.id && e.unread && !e.me && shown.has(i)) ids.add(e.id);
	});
	return [...ids];
}

export function foldRows(entries: ThreadEntry[], open: ReadonlySet<string>, revealed: boolean): FoldRow[] {
	const n = entries.length;
	const shown = alwaysShown(n);
	entries.forEach((e, i) => {
		if (e.id && open.has(e.id)) shown.add(i);
	});
	const rows: FoldRow[] = [];
	let i = 0;
	while (i < n) {
		if (revealed || shown.has(i)) {
			rows.push({ kind: 'entry', index: i });
			i++;
			continue;
		}
		let j = i;
		while (j < n && !shown.has(j)) j++;
		if (j - i === 1) rows.push({ kind: 'entry', index: i });
		else rows.push({ kind: 'fold', start: i, count: j - i });
		i = j;
	}
	return rows;
}
