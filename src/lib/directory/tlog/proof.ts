import { bytesFromBase64 } from './bytes';

export interface TlogProofBundle {
	extra: Uint8Array | null;
	index: bigint;
	path: Uint8Array[];
	checkpointNote: string;
}

const HEADER = 'c2sp.org/tlog-proof@v1';

export function parseTlogProof(raw: string): TlogProofBundle {
	const split = raw.indexOf('\n\n');
	if (split < 0) throw new Error('proof missing checkpoint separator');
	const headerLines = raw.slice(0, split).split('\n');
	const checkpointNote = raw.slice(split + 2);
	if (headerLines.shift() !== HEADER) throw new Error('bad proof header');
	let extra: Uint8Array | null = null;
	if (headerLines[0]?.startsWith('extra ')) {
		extra = bytesFromBase64(headerLines.shift()!.slice(6));
	}
	const indexLine = headerLines.shift();
	if (indexLine === undefined || !indexLine.startsWith('index ')) {
		throw new Error('missing index line');
	}
	const indexStr = indexLine.slice(6);
	if (!/^(0|[1-9][0-9]*)$/.test(indexStr)) throw new Error('invalid index');
	const index = BigInt(indexStr);
	const path: Uint8Array[] = [];
	for (const line of headerLines) {
		const hash = bytesFromBase64(line);
		if (hash.length !== 32) throw new Error('invalid inclusion hash length');
		path.push(hash);
	}
	if (checkpointNote.length === 0) throw new Error('proof missing checkpoint');
	return { extra, index, path, checkpointNote };
}
