import { m } from '$paraglide/messages.js';

export const COLLECTION_COLORS = {
	pine: 'var(--pine-500)',
	brass: 'var(--brass-600)',
	info: 'var(--info-500)',
	warning: 'var(--warning-500)',
	danger: 'var(--danger-500)',
	ink: 'var(--ink-400)'
} as const;

export type CollectionColor = keyof typeof COLLECTION_COLORS;

export const COLLECTION_COLOR_NAMES: Record<CollectionColor, () => string> = {
	pine: () => m.mail_collection_color_green(),
	brass: () => m.mail_collection_color_gold(),
	info: () => m.mail_collection_color_blue(),
	warning: () => m.mail_collection_color_orange(),
	danger: () => m.mail_collection_color_red(),
	ink: () => m.mail_collection_color_gray()
};

export const COLLECTION_COLOR_KEYS = Object.keys(COLLECTION_COLORS) as CollectionColor[];

export function collectionColor(key: string | null | undefined): string {
	return key && key in COLLECTION_COLORS
		? COLLECTION_COLORS[key as CollectionColor]
		: COLLECTION_COLORS.ink;
}

const CHIP_TONES: Record<CollectionColor, { bg: string; fg: string }> = {
	pine: { bg: 'var(--pine-100)', fg: 'var(--pine-700)' },
	brass: { bg: 'var(--brass-100)', fg: 'var(--brass-700)' },
	info: { bg: 'var(--info-100)', fg: 'var(--info-700)' },
	warning: { bg: 'var(--warning-100)', fg: 'var(--warning-700)' },
	danger: { bg: 'var(--danger-100)', fg: 'var(--danger-700)' },
	ink: { bg: 'var(--paper-100)', fg: 'var(--ink-700)' }
};

export function collectionChip(key: string | null | undefined): { bg: string; fg: string } {
	return key && key in CHIP_TONES ? CHIP_TONES[key as CollectionColor] : CHIP_TONES.ink;
}
