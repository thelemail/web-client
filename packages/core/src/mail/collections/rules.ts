import { m } from '$paraglide/messages.js';
import { ApiCallError, type FolderDestination, type MailCollectionKind } from '$core/api/types';
import { CollectionSealError } from './seal';
import { subtreeIds, type CollectionEntry, type CollectionNode } from './tree';

export interface DeletedCollection {
	entry: CollectionEntry;
	destination: { kind: FolderDestination; folderId?: string } | null;
}

export const MAX_COLLECTION_NAME = 120;
export const MAX_COLLECTION_DEPTH = 16;

export type NameProblem = 'empty' | 'too_long' | 'slash' | 'duplicate';
export type MoveProblem = 'inside' | 'missing' | 'too_deep' | 'duplicate';
export type RuleProblem = NameProblem | MoveProblem | 'has_children';

export class CollectionRuleError extends Error {
	constructor(readonly problem: RuleProblem) {
		super(problem);
		this.name = 'CollectionRuleError';
	}
}

export function foldName(name: string): string {
	return name.trim().normalize('NFC').toLocaleLowerCase();
}

function siblingNamed(
	nodes: readonly CollectionNode[],
	kind: MailCollectionKind,
	parentId: string | null,
	name: string,
	selfId?: string
): boolean {
	const key = foldName(name);
	return nodes.some(
		(n) =>
			n.kind === kind &&
			n.id !== selfId &&
			!n.sealed &&
			(n.parentId ?? null) === parentId &&
			foldName(n.name) === key
	);
}

export function ambiguousNames(entries: readonly { name: string }[]): Set<string> {
	const seen = new Set<string>();
	const twice = new Set<string>();
	for (const e of entries) {
		const key = foldName(e.name);
		if (seen.has(key)) twice.add(key);
		seen.add(key);
	}
	return twice;
}

export function nameProblem(
	nodes: readonly CollectionNode[],
	kind: MailCollectionKind,
	parentId: string | null,
	name: string,
	selfId?: string
): NameProblem | null {
	const trimmed = name.trim();
	if (!trimmed) return 'empty';
	if (trimmed.length > MAX_COLLECTION_NAME) return 'too_long';
	if (trimmed.includes('/')) return 'slash';
	if (siblingNamed(nodes, kind, parentId, trimmed, selfId)) return 'duplicate';
	return null;
}

export function levelOf(nodes: readonly CollectionNode[], id: string): number {
	const byId = new Map(nodes.map((n) => [n.id, n]));
	let level = 0;
	const seen = new Set<string>();
	for (let cur = byId.get(id); cur && !seen.has(cur.id); cur = byId.get(cur.parentId ?? '')) {
		seen.add(cur.id);
		level++;
	}
	return level;
}

export function heightOf(nodes: readonly CollectionNode[], id: string): number {
	const children = new Map<string, string[]>();
	for (const n of nodes) {
		if (!n.parentId) continue;
		const list = children.get(n.parentId) ?? [];
		list.push(n.id);
		children.set(n.parentId, list);
	}
	const seen = new Set<string>();
	const walk = (cur: string): number => {
		if (seen.has(cur)) return 0;
		seen.add(cur);
		let h = 1;
		for (const child of children.get(cur) ?? []) h = Math.max(h, walk(child) + 1);
		return h;
	};
	return walk(id);
}

export function moveProblem(
	nodes: readonly CollectionNode[],
	id: string,
	parentId: string | null
): MoveProblem | null {
	const self = nodes.find((n) => n.id === id);
	if (!self) return 'missing';
	if (parentId !== null) {
		if (parentId === id || subtreeIds(nodes, id).includes(parentId)) return 'inside';
		const parent = nodes.find((n) => n.id === parentId);
		if (!parent || parent.kind !== self.kind) return 'missing';
		if (levelOf(nodes, parentId) + heightOf(nodes, id) > MAX_COLLECTION_DEPTH) return 'too_deep';
	}
	if (siblingNamed(nodes, self.kind, parentId, self.name, id)) return 'duplicate';
	return null;
}

export function ruleText(kind: MailCollectionKind, problem: RuleProblem): string {
	const folder = kind === 'folder';
	switch (problem) {
		case 'empty':
			return m.mail_collection_name_empty();
		case 'too_long':
			return m.mail_collection_name_too_long({ max: MAX_COLLECTION_NAME });
		case 'slash':
			return m.mail_collection_name_slash();
		case 'duplicate':
			return folder ? m.mail_collection_name_taken_folder() : m.mail_collection_name_taken_label();
		case 'inside':
			return folder ? m.mail_collection_move_inside_folder() : m.mail_collection_move_inside_label();
		case 'missing':
			return m.mail_collection_move_missing();
		case 'too_deep':
			return m.mail_collection_move_too_deep({ max: MAX_COLLECTION_DEPTH });
		case 'has_children':
			return folder ? m.mail_collection_delete_has_subfolders() : m.mail_collection_delete_has_sublabels();
	}
}

export function collectionErrorText(err: unknown, kind: MailCollectionKind, fallback: string): string {
	if (err instanceof CollectionRuleError) return ruleText(kind, err.problem);
	if (err instanceof CollectionSealError && err.code === 'locked') return m.mail_collection_unlock_required();
	if (err instanceof ApiCallError) {
		const text = (err.envelope?.error?.message ?? '').toLowerCase();
		if (err.status === 404 || text === 'invalid parent') return ruleText(kind, 'missing');
		if (err.status === 409) {
			if (text.includes('inside itself')) return ruleText(kind, 'inside');
			if (text.includes('levels deep')) return ruleText(kind, 'too_deep');
			if (text.includes("what's inside")) return ruleText(kind, 'has_children');
			if (text.includes('limit')) return m.mail_collection_limit();
			if (text.includes('another device')) return m.mail_collection_changed_elsewhere();
		}
	}
	return fallback;
}
