import type { Chip } from '$core/search/chips';
import type { CoverageView } from '$core/search/coverage';
import type { Range } from '$core/search/query/ast';
import type { Consent } from '$core/search/runtime/records';
import type { Sort } from '$core/search/sqlite/compile';
import type { Suggestion } from '$core/search/sqlite/suggest';
import type { SearchPhase } from '$core/stores/search.svelte';

export interface SearchView {
	phase: SearchPhase;
	mode: 'saved' | 'preview' | 'desktop';
	consent: Consent | null;
	canEnable: boolean;
	query: string;
	matches: number | null;
	groups: number | null;
	final: boolean;
	chips: Chip[];
	error: string | null;
	errorRange: Range | null;
	suggestions: Suggestion[];
	coverage: CoverageView | null;
	sort: Sort;
	exactFolders: boolean;
	newAvailable: boolean;
	paused: boolean;
	limited: 'session' | 'quota' | null;
	settingsHref: string;
	onSort: (sort: Sort) => void;
	onExactFolders: (exact: boolean) => void;
	onRemoveChip: (chip: Chip) => void;
	onSuggestion: (s: Suggestion) => void;
	onRefresh: () => void;
	onRetry: () => void;
	onClear: () => void;
	onEnable: () => void;
	onDecline: () => void;
}
