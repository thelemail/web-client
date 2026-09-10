import type { Action } from 'svelte/action';

export const portal: Action<HTMLElement, HTMLElement | string | undefined> = (
	node,
	target = document.body
) => {
	function mount(t: HTMLElement | string | undefined) {
		const dest = typeof t === 'string' ? document.querySelector<HTMLElement>(t) : t;
		(dest ?? document.body).appendChild(node);
	}

	mount(target);

	return {
		update: mount,
		destroy() {
			node.parentNode?.removeChild(node);
		}
	};
};
