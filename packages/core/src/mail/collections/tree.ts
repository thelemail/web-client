import type { MailCollectionKind } from '$core/api/types';

export interface CollectionNode {
	id: string;
	kind: MailCollectionKind;
	parentId: string | null;
	position: number;
	rev: number;
	name: string;
	color: string | null;
	sealed: boolean;
}

export interface CollectionEntry extends CollectionNode {
	depth: number;
	path: string;
}

const POSITION_STEP = 1024;

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
