import type { MailCollectionKind } from '$core/api/types';

export interface CollectionNode {
	id: string;
	kind: MailCollectionKind;
	parentId: string | null;
	position: number;
	rev: number;
	name: string;
	color: string | null;
	favorite: boolean;
	sealed: boolean;
}

export interface CollectionEntry extends CollectionNode {
	depth: number;
	path: string;
}

export const POSITION_STEP = 1024;

export function orderTree(nodes: CollectionNode[]): CollectionEntry[] {
	const byParent = new Map<string | null, CollectionNode[]>();
	const ids = new Set(nodes.map((n) => n.id));
	for (const n of nodes) {
		const parent = n.parentId && ids.has(n.parentId) ? n.parentId : null;
		const list = byParent.get(parent) ?? [];
		list.push(n);
		byParent.set(parent, list);
	}
	for (const list of byParent.values()) {
		list.sort(
			(a, b) =>
				a.position - b.position ||
				a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) ||
				a.id.localeCompare(b.id)
		);
	}
	const out: CollectionEntry[] = [];
	const seen = new Set<string>();
	const walk = (parent: string | null, depth: number, prefix: string) => {
		for (const n of byParent.get(parent) ?? []) {
			if (seen.has(n.id)) continue;
			seen.add(n.id);
			const path = prefix ? `${prefix} / ${n.name}` : n.name;
			out.push({ ...n, depth, path });
			walk(n.id, depth + 1, path);
		}
	};
	walk(null, 0, '');
	return out;
}

export function childIds(nodes: readonly CollectionNode[], id: string): string[] {
	return orderTree(nodes.filter((n) => n.parentId === id)).map((e) => e.id);
}

export function nextPosition(nodes: CollectionNode[], parentId: string | null): number {
	let max = 0;
	for (const n of nodes) {
		if ((n.parentId ?? null) === parentId && n.position > max) max = n.position;
	}
	return max + POSITION_STEP;
}

export function subtreeIds(nodes: readonly CollectionNode[], id: string): string[] {
	const children = new Map<string, string[]>();
	for (const n of nodes) {
		if (!n.parentId) continue;
		const list = children.get(n.parentId) ?? [];
		list.push(n.id);
		children.set(n.parentId, list);
	}
	const out = [id];
	const seen = new Set(out);
	for (let i = 0; i < out.length; i++) {
		for (const child of children.get(out[i]) ?? []) {
			if (seen.has(child)) continue;
			seen.add(child);
			out.push(child);
		}
	}
	return out;
}

export function visibleEntries(
	entries: readonly CollectionEntry[],
	expanded: ReadonlySet<string>
): CollectionEntry[] {
	const out: CollectionEntry[] = [];
	let hiddenBelow = Infinity;
	for (const e of entries) {
		if (e.depth > hiddenBelow) continue;
		hiddenBelow = expanded.has(e.id) ? Infinity : e.depth;
		out.push(e);
	}
	return out;
}

export function siblingIds(entries: readonly CollectionEntry[], id: string): string[] {
	const self = entries.find((e) => e.id === id);
	if (!self) return [];
	return entries
		.filter((e) => e.depth === self.depth && (e.parentId ?? null) === (self.parentId ?? null))
		.map((e) => e.id);
}

export function moveAmongSiblings(ids: readonly string[], id: string, toIndex: number): string[] {
	const from = ids.indexOf(id);
	if (from < 0) return [...ids];
	const next = ids.filter((x) => x !== id);
	const at = Math.max(0, Math.min(toIndex, next.length));
	next.splice(at, 0, id);
	return next;
}

export function ancestorIds(entries: readonly CollectionEntry[], id: string): string[] {
	const byId = new Map(entries.map((e) => [e.id, e]));
	const out: string[] = [];
	const seen = new Set<string>([id]);
	let cur = byId.get(id)?.parentId ?? null;
	while (cur && byId.has(cur) && !seen.has(cur)) {
		seen.add(cur);
		out.push(cur);
		cur = byId.get(cur)?.parentId ?? null;
	}
	return out;
}

export function filterEntries(entries: readonly CollectionEntry[], query: string): CollectionEntry[] {
	const q = query.trim().toLocaleLowerCase();
	if (!q) return [...entries];
	const keep = new Set<string>();
	for (const e of entries) {
		if (!e.name.toLocaleLowerCase().includes(q)) continue;
		keep.add(e.id);
		for (const a of ancestorIds(entries, e.id)) keep.add(a);
	}
	return entries.filter((e) => keep.has(e.id));
}
