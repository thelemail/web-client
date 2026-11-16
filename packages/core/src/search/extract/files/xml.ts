import sax from 'sax';
import { Stop, type Sink } from './sink';

const CHUNK = 64 * 1024;

export interface XmlVisitor {
	open(name: string, attrs: Readonly<Record<string, string>>): void;
	close(name: string): void;
	text(text: string): void;
}

export function localName(name: string): string {
	const i = name.indexOf(':');
	return i < 0 ? name : name.slice(i + 1);
}

export function attr(attrs: Readonly<Record<string, string>>, name: string, prefixed = false): string | undefined {
	if (!prefixed) return attrs[name];
	for (const [k, v] of Object.entries(attrs)) if (k.includes(':') && localName(k) === name) return v;
	return undefined;
}

function decodeXml(bytes: Uint8Array): string {
	if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
	if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
	return new TextDecoder('utf-8').decode(bytes);
}

export function walkXml(bytes: Uint8Array, sink: Sink, visitor: XmlVisitor): void {
	const parser = sax.parser(true, { trim: false, normalize: false, xmlns: false, position: false, strictEntities: true });
	let depth = 0;
	let node = 0;
	let failure: Stop | null = null;
	const fail = (stop: Stop) => {
		failure ??= stop;
		throw stop;
	};
	parser.ondoctype = () => fail(new Stop('malformed'));
	parser.onerror = () => fail(new Stop('malformed'));
	parser.onopentag = (tag) => {
		node = 0;
		if (++depth > sink.limits.maxDepth) fail(new Stop('partial'));
		const attrs: Record<string, string> = {};
		for (const [k, v] of Object.entries(tag.attributes)) attrs[k] = typeof v === 'string' ? v : v.value;
		visitor.open(localName(tag.name), attrs);
	};
	parser.onclosetag = (name) => {
		node = 0;
		depth--;
		visitor.close(localName(name));
	};
	parser.ontext = (text) => {
		node += text.length;
		if (node > sink.limits.maxNode) fail(new Stop('partial'));
		visitor.text(text);
	};
	parser.oncdata = parser.ontext;
	const text = decodeXml(bytes);
	try {
		for (let i = 0; i < text.length; i += CHUNK) {
			parser.write(text.slice(i, i + CHUNK));
			sink.tick();
		}
		parser.close();
	} catch (error) {
		if (failure) throw failure;
		if (error instanceof Stop) throw error;
		throw new Stop('malformed');
	}
}
