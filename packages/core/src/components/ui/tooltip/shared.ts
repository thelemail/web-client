import { Tooltip } from 'bits-ui';

export interface Tip {
	label: string;
	shortcut?: string;
}

export type TipTether = Tooltip.Tether<Tip>;

export function createTipTether(): TipTether {
	return Tooltip.createTether<Tip>();
}
