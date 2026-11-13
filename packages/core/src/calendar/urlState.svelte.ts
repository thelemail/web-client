import { untrack } from 'svelte';
import { goto } from '$app/navigation';
import { page } from '$app/state';
import { cal } from './state.svelte';
import type { View } from './types';

const URL_VIEWS: readonly View[] = ['week', 'month', 'agenda', 'avail'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isUrlView(value: string | null): value is View {
	return value !== null && (URL_VIEWS as readonly string[]).includes(value);
}

export function syncCalendarUrl(): void {
	const params = page.url.searchParams;
	const view = params.get('view');
	const date = params.get('date');
	if (isUrlView(view)) cal.goTo(view);
	if (date && DATE.test(date)) cal.anchor = date;

	$effect(() => {
		const current = cal.view;
		const anchor = cal.anchor;
		untrack(() => {
			if (!isUrlView(current)) return;
			const url = new URL(window.location.href);
			if (current === 'week') url.searchParams.delete('view');
			else url.searchParams.set('view', current);
			if (anchor === cal.today) url.searchParams.delete('date');
			else url.searchParams.set('date', anchor);
			if (url.search === window.location.search) return;
			void goto(url, { replace: true, reset: false, shallow: true });
		});
	});
}
