import type { ParseRequest, ParseResult } from '$core/search/extract/parse';

export type ToWorker = { type: 'init'; assets: [string, Uint8Array][] } | { type: 'job'; id: number; request: ParseRequest };

export type FromWorker = { type: 'tick'; id: number } | { type: 'done'; id: number; result: ParseResult } | { type: 'error'; id: number };
