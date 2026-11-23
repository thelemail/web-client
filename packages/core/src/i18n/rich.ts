export interface RichSegment {
	text: string;
	tag?: string;
}

const TAG = /<([a-z][a-z0-9]*)>([\s\S]*?)<\/\1>/g;

export function richSegments(text: string): RichSegment[] {
	const segments: RichSegment[] = [];
	let last = 0;
	for (const match of text.matchAll(TAG)) {
		const start = match.index ?? 0;
		if (start > last) segments.push({ text: text.slice(last, start) });
		segments.push({ tag: match[1], text: match[2] });
		last = start + match[0].length;
	}
	if (last < text.length) segments.push({ text: text.slice(last) });
	return segments;
}

export interface GluedSegment extends RichSegment {
	tail?: string;
}

const TRAILING = /^[  ]?[.,:;!?…)\]»”’"']+/;

export function glueTrailing(segments: RichSegment[]): GluedSegment[] {
	const out: GluedSegment[] = [];
	for (let i = 0; i < segments.length; i++) {
		const seg = segments[i];
		const next = segments[i + 1];
		if (seg.tag && next && !next.tag) {
			const hit = TRAILING.exec(next.text);
			if (hit) {
				out.push({ ...seg, tail: hit[0] });
				const rest = next.text.slice(hit[0].length);
				if (rest) out.push({ text: rest });
				i++;
				continue;
			}
		}
		out.push(seg);
	}
	return out;
}
