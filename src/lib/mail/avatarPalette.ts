export interface AvatarPalette {
	bg: string;
	fg: string;
}

const PALETTE: ReadonlyArray<AvatarPalette> = [
	{ bg: 'var(--brass-100)', fg: 'var(--brass-700)' },
	{ bg: 'var(--pine-100)', fg: 'var(--pine-700)' },
	{ bg: 'var(--info-100)', fg: 'var(--info-700)' },
	{ bg: 'var(--success-100)', fg: 'var(--success-700)' },
	{ bg: 'var(--paper-200)', fg: 'var(--ink-700)' }
];

export function paletteFor(seed: string): AvatarPalette {
	let h = 0;
	for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
	return PALETTE[h % PALETTE.length];
}
