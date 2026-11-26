import type SearchStrip from './SearchStrip.svelte';

export type SearchStripComponent = typeof SearchStrip;

let loaded: SearchStripComponent | null = null;
let loading: Promise<SearchStripComponent> | null = null;

export function loadedSearchStrip(): SearchStripComponent | null {
	return loaded;
}

import type SearchRelated from './SearchRelated.svelte';

export type SearchRelatedComponent = typeof SearchRelated;

let related: SearchRelatedComponent | null = null;
let relatedLoading: Promise<SearchRelatedComponent> | null = null;

export function loadedSearchRelated(): SearchRelatedComponent | null {
	return related;
}

export function loadSearchRelated(): Promise<SearchRelatedComponent> {
	relatedLoading ??= import('./SearchRelated.svelte').then(
		(m) => (related = m.default),
		(error) => {
			relatedLoading = null;
			throw error;
		}
	);
	return relatedLoading;
}

export function loadSearchStrip(): Promise<SearchStripComponent> {
	loading ??= import('./SearchStrip.svelte').then(
		(m) => (loaded = m.default),
		(error) => {
			loading = null;
			throw error;
		}
	);
	return loading;
}
