import {
	isLabelId,
	isRouteFolder,
	type LabelId,
	type RouteFolder,
	type SortId
} from './data';

export interface Query {
	folder: RouteFolder;
	labels: LabelId[];
	unread: boolean;
	attach: boolean;
	sort: SortId;
}

export const DEFAULT_QUERY: Query = {
	folder: 'inbox',
	labels: [],
	unread: false,
	attach: false,
	sort: 'newest'
};

function parseLabels(raw: string | null): LabelId[] {
	if (!raw) return [];
	const out: LabelId[] = [];
	const seen = new Set<string>();
	for (const part of raw.split(',')) {
		const trimmed = part.trim();
		if (!trimmed || seen.has(trimmed)) continue;
		seen.add(trimmed);
		if (isLabelId(trimmed)) out.push(trimmed);
	}
	return out;
}

function parseBool(raw: string | null): boolean {
	return raw === 'true' || raw === '1';
}

function parseSort(raw: string | null): SortId {
	return raw === 'oldest' ? 'oldest' : 'newest';
}

export function parseQuery(folderParam: string | undefined, sp: URLSearchParams): Query {
	const folder: RouteFolder = folderParam && isRouteFolder(folderParam) ? folderParam : 'inbox';
	return {
		folder,
		labels: parseLabels(sp.get('labels')),
		unread: parseBool(sp.get('unread')),
		attach: parseBool(sp.get('attach')),
		sort: parseSort(sp.get('sort'))
	};
}

function buildSearch(
	sp: URLSearchParams,
	patch: Partial<Pick<Query, 'labels' | 'unread' | 'attach' | 'sort'>>
): string {
	const next = new URLSearchParams(sp);

	if ('labels' in patch) {
		const labels = patch.labels ?? [];
		if (labels.length === 0) next.delete('labels');
		else next.set('labels', labels.join(','));
	}
	if ('unread' in patch) {
		if (patch.unread) next.set('unread', 'true');
		else next.delete('unread');
	}
	if ('attach' in patch) {
		if (patch.attach) next.set('attach', 'true');
		else next.delete('attach');
	}
	if ('sort' in patch) {
		if (patch.sort === 'oldest') next.set('sort', 'oldest');
		else next.delete('sort');
	}

	const qs = next.toString();
	return qs ? `?${qs}` : '';
}

export function withFilters(
	sp: URLSearchParams,
	patch: Partial<Pick<Query, 'labels' | 'unread' | 'attach' | 'sort'>>
): string {
	return buildSearch(sp, patch);
}

export function toggleLabel(sp: URLSearchParams, label: LabelId): string {
	const current = parseLabels(sp.get('labels'));
	const idx = current.indexOf(label);
	const next = idx >= 0 ? current.filter((l) => l !== label) : [...current, label];
	return buildSearch(sp, { labels: next });
}

export function clearFilters(sp: URLSearchParams): string {
	return buildSearch(sp, { labels: [], unread: false, attach: false });
}

