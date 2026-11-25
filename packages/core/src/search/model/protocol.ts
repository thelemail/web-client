import type { Field } from '../sqlite/types';
import type { PassageRef, SourcePart } from './recipe';

export type ModelFailure = 'assets' | 'memory' | 'wasm' | 'tooMany' | 'tooLong' | 'invalid' | 'cancelled' | 'closed';

export interface EmbedInput {
	subject: string | null;
	parts: SourcePart[];
}

export interface EmbeddedPassage {
	field: Field;
	attachmentId: string | null;
	place: string | null;
	refs: PassageRef[];
	vector: Float32Array;
}

export type ModelRequest =
	| { op: 'load'; id: number }
	| { op: 'embed'; id: number; input: EmbedInput }
	| { op: 'query'; id: number; text: string }
	| { op: 'cancel'; id: number };

export type ModelReply = { type: 'reply'; id: number; ok: true; value: unknown } | { type: 'reply'; id: number; ok: false; reason: ModelFailure };

export interface ModelProgress {
	type: 'progress';
	loaded: number;
	total: number;
}

export type ModelMessage = ModelReply | ModelProgress;

export interface ModelInit {
	op: 'init';
	port: MessagePort;
}
