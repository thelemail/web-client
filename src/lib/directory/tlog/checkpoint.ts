import { bytesFromBase64 } from './bytes';
import { parseNote, type ParsedNote } from './note';

export interface Checkpoint {
	origin: string;
	treeSize: number;
	rootHash: Uint8Array;
	note: ParsedNote;
}

export function parseCheckpoint(raw: string): Checkpoint {
	const note = parseNote(raw);
	const lines = note.text.split('\n');
	if (lines.pop() !== '') throw new Error('checkpoint body must end with newline');
	if (lines.length < 3) throw new Error('checkpoint body too short');
	const origin = lines[0];
	if (origin.length === 0) throw new Error('checkpoint origin empty');
	if (!/^(0|[1-9][0-9]*)$/.test(lines[1])) throw new Error('invalid tree size');
	const treeSize = Number(lines[1]);
	if (!Number.isSafeInteger(treeSize)) throw new Error('tree size out of range');
	const rootHash = bytesFromBase64(lines[2]);
	if (rootHash.length !== 32) throw new Error('invalid root hash length');
	return { origin, treeSize, rootHash, note };
}
