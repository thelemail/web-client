/// <reference lib="webworker" />

import type { KeystoreCommand } from '../protocol';

export interface RequestMessage {
	id: string;
	cmd: KeystoreCommand;
	args?: unknown;
}

export interface ResponseMessage {
	type: 'response';
	id: string;
	value?: unknown;
	error?: string;
}

export function respond(port: MessagePort, id: string, value: unknown) {
	const msg: ResponseMessage = { type: 'response', id, value };
	port.postMessage(msg);
}

export function respondError(port: MessagePort, id: string, error: unknown) {
	const msg: ResponseMessage = {
		type: 'response',
		id,
		error: error instanceof Error ? error.message : String(error)
	};
	port.postMessage(msg);
}
