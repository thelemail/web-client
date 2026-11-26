import { cubicOut } from 'svelte/easing';
import { prefersReducedMotion } from 'svelte/motion';
import { slide, type TransitionConfig } from 'svelte/transition';

export function unfold(node: Element): TransitionConfig {
	const base = slide(node, { duration: prefersReducedMotion.current ? 0 : 260, easing: cubicOut });
	return {
		...base,
		css: (t, u) => `${base.css?.(t, u) ?? ''};opacity:${t}`
	};
}
