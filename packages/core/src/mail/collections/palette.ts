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
