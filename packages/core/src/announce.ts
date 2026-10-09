let region: HTMLElement | null = null;
let pending: ReturnType<typeof setTimeout> | undefined;

function liveRegion(): HTMLElement {
	if (region?.isConnected) return region;
	region = document.createElement('div');
	region.setAttribute('role', 'status');
	region.setAttribute('aria-live', 'polite');
	region.setAttribute('aria-atomic', 'true');
	Object.assign(region.style, {
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
	document.body.appendChild(region);
	return region;
}

export function announce(text: string): void {
	if (typeof document === 'undefined') return;
	const el = liveRegion();
	clearTimeout(pending);
	el.textContent = '';
	pending = setTimeout(() => {
		el.textContent = text;
		pending = setTimeout(() => {
			el.textContent = '';
		}, 7000);
	}, 100);
}
