import { getContext, setContext } from 'svelte';

export interface RowNames {
	readonly labelId: string;
	readonly descId: string | undefined;
}

const ROW = Symbol('settings-row');
const LEVEL = Symbol('settings-heading-level');

export function setRowNames(names: RowNames | undefined): void {
	setContext(ROW, names);
}

export function getRowNames(): RowNames | undefined {
	return getContext<RowNames | undefined>(ROW);
}

export function setHeadingLevel(level: number): void {
	setContext(LEVEL, level);
}

export function getHeadingLevel(): number {
	return getContext<number | undefined>(LEVEL) ?? 2;
}
