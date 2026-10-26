import { goto } from '$app/navigation';
import { page } from '$app/state';
import type { DomainStep } from './steps';

export function showStepInUrl(step: DomainStep): void {
	const url = new URL(window.location.href);
	if (url.searchParams.get('step') === step) return;
	url.searchParams.set('step', step);
	void goto(url, { shallow: true, replace: true, state: page.state });
}
