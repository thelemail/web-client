export interface AvatarPalette {
	bg: string;
	fg: string;
}

const PALETTE: AvatarPalette[] = [
	{ bg: 'var(--pine-700)', fg: '#EEF2EA' },
	{ bg: 'var(--brass-700, #8a6a2e)', fg: '#FBF8EE' },
	{ bg: '#6b4f8a', fg: '#F4EEF8' },
	{ bg: '#2d6a6a', fg: '#E9F4F4' },
	{ bg: '#8a4f4f', fg: '#F8EEEE' }
];

export function avatarPaletteFor(accountId: string): AvatarPalette {
	let h = 0;
	for (let i = 0; i < accountId.length; i++) h = (h * 31 + accountId.charCodeAt(i)) >>> 0;
	return PALETTE[h % PALETTE.length];
}
