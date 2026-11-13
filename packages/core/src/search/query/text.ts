import { normalize } from '../sqlite/analysis';
import type { TextLane } from './ast';

const IDENTIFIER = /[^\p{L}\p{N}\p{M}'’]/u;

export function foldText(value: string): string {
	return normalize(value).toLowerCase();
}

export function laneOf(text: string): TextLane {
	return IDENTIFIER.test(text) ? 'identifier' : 'word';
}

export function codePoints(value: string): number {
	return [...value].length;
}

export function isAddress(value: string): boolean {
	return /^[^\s@<>()",;]+@[^\s@<>()",;]+$/u.test(value);
}
