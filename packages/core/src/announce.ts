interface Region {
	el: HTMLElement | null;
	pending: ReturnType<typeof setTimeout> | undefined;
}

const polite: Region = { el: null, pending: undefined };
const assertive: Region = { el: null, pending: undefined };

function liveRegion(region: Region, urgent: boolean): HTMLElement {
	if (region.el?.isConnected) return region.el;
	const el = document.createElement('div');
	el.setAttribute('role', urgent ? 'alert' : 'status');
	el.setAttribute('aria-live', urgent ? 'assertive' : 'polite');
	el.setAttribute('aria-atomic', 'true');
	Object.assign(el.style, {
		position: 'absolute',
		width: '1px',
		height: '1px',
		margin: '-1px',
		padding: '0',
		overflow: 'hidden',
		clip: 'rect(0 0 0 0)',
		whiteSpace: 'nowrap',
		border: '0'
	});
	document.body.appendChild(el);
	region.el = el;
	return el;
}

export function announce(text: string, opts: { assertive?: boolean } = {}): void {
	if (typeof document === 'undefined') return;
	const urgent = opts.assertive === true;
	const region = urgent ? assertive : polite;
	const el = liveRegion(region, urgent);
	clearTimeout(region.pending);
	el.textContent = '';
	region.pending = setTimeout(() => {
		el.textContent = text;
		region.pending = setTimeout(() => {
			el.textContent = '';
		}, 7000);
	}, 100);
}
