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
