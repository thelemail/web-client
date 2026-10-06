import type FolderIcon from '@lucide/svelte/icons/folder';
import type { CollectionEntry } from './tree';

export type CheckState = 'on' | 'off' | 'mixed';

export interface PickerRow {
	key: string;
	title: string;
	path?: string;
	depth?: number;
	dot?: string;
	icon?: typeof FolderIcon;
	iconColor?: string;
	check?: CheckState;
	pick: () => void;
}

export interface PickerSection {
	key: string;
	title?: string;
	rows: PickerRow[];
}

function fold(s: string): string {
	return s.toLocaleLowerCase().replace(/\s*\/\s*/g, '/').trim();
}

function matchRank(entry: CollectionEntry, q: string): number {
	const name = fold(entry.name);
	const path = fold(entry.path);
	if (name.startsWith(q)) return 0;
	if (path.startsWith(q) || path.includes(`/${q}`)) return 1;
	if (name.includes(q)) return 2;
	if (path.includes(q)) return 3;
	return -1;
}

export function searchEntries(entries: readonly CollectionEntry[], query: string): CollectionEntry[] {
	const q = fold(query);
	if (!q) return [...entries];
	return entries
		.map((entry, i) => ({ entry, i, rank: matchRank(entry, q) }))
		.filter((r) => r.rank >= 0)
		.sort((a, b) => a.rank - b.rank || a.i - b.i)
		.map((r) => r.entry);
}

export function hasExactName(entries: readonly CollectionEntry[], query: string): boolean {
	const q = fold(query);
	return entries.some((e) => fold(e.name) === q || fold(e.path) === q);
}

export function labelStates(labelSets: readonly (readonly string[])[]): Map<string, CheckState> {
	const counts = new Map<string, number>();
	for (const set of labelSets) {
		for (const id of new Set(set)) counts.set(id, (counts.get(id) ?? 0) + 1);
	}
	const out = new Map<string, CheckState>();
	for (const [id, n] of counts) out.set(id, n === labelSets.length ? 'on' : 'mixed');
	return out;
}

export function nextCheckState(current: CheckState, initial: CheckState): CheckState {
	if (current === 'mixed') return 'on';
	if (current === 'on') return 'off';
	return initial === 'mixed' ? 'mixed' : 'on';
}

export function labelChanges(
	initial: ReadonlyMap<string, CheckState>,
	staged: ReadonlyMap<string, CheckState>
): { add: string[]; remove: string[] } {
	const add: string[] = [];
	const remove: string[] = [];
	for (const [id, state] of staged) {
		const was = initial.get(id) ?? 'off';
		if (state === was || state === 'mixed') continue;
		if (state === 'on') add.push(id);
		else remove.push(id);
	}
	return { add, remove };
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}
