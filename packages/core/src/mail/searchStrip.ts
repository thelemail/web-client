import type SearchStrip from './SearchStrip.svelte';

export type SearchStripComponent = typeof SearchStrip;

let loaded: SearchStripComponent | null = null;
let loading: Promise<SearchStripComponent> | null = null;

export function loadedSearchStrip(): SearchStripComponent | null {
	return loaded;
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
