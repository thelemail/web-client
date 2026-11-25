import { DOCUMENT_EPOCH } from '../extract/epochs';
import { DIMENSIONS } from './pool';
import { RECIPE } from './recipe';

export const VECTOR_FORMAT = { storage: 'fp16-le', dimensions: DIMENSIONS, pooling: 'attention-mean', normalization: 'l2' } as const;

function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	if (value && typeof value === 'object') {
		const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
	}
	return JSON.stringify(value);
}

export function epochInput(manifestHash: string, documentEpoch: number = DOCUMENT_EPOCH): string {
	return canonical({ recipe: RECIPE, vector: VECTOR_FORMAT, documentEpoch, manifest: manifestHash });
}

export async function semanticEpoch(manifestHash: string, documentEpoch: number = DOCUMENT_EPOCH): Promise<number> {
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(epochInput(manifestHash, documentEpoch))));
	let n = 0;
	for (let i = 0; i < 6; i++) n = n * 256 + digest[i];
	return n;
}
