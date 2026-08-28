import DOMPurify from 'dompurify';
import type { UponSanitizeAttributeHookEvent } from 'dompurify';
import type { InlineImage } from './parseMime';
import { stripTrackingParams } from './trackingStrip';

export interface SanitizeOptions {
	inlineImages: Record<string, InlineImage>;
	stripTracking?: boolean;
}

const ALLOWED_URI_REGEXP = /^(?:(?:https?|mailto|tel|cid|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

const FORBID_TAGS = [
	'script',
	'iframe',
	'object',
	'embed',
	'form',
	'link',
	'meta',
	'base',
	'svg',
	'math'
];

const FORBID_ATTR = ['srcset', 'formaction', 'ping', 'background'];

function bytesToBase64(bytes: Uint8Array): string {
	let bin = '';
	for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
	return btoa(bin);
}

function scrubCss(css: string): string {
	let out = css.replace(/@import[^;]*;?/gi, '');
	out = out.replace(/@font-face\s*\{[^}]*\}/gi, '');
	out = out.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (_, _q, url) => {
		const trimmed = String(url).trim();
		if (/^(?:cid|data):/i.test(trimmed)) return `url(${trimmed})`;
		return 'url(about:blank)';
	});
	return out;
}

function scrubStyleTags(html: string): string {
	return html.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (_, attrs: string, body: string) => {
		return `<style${attrs}>${scrubCss(body)}</style>`;
	});
}

export function sanitizeHtml(raw: string, opts: SanitizeOptions): string {
	const pre = scrubStyleTags(raw);

	const cidMap = new Map<string, string>();
	for (const [cid, img] of Object.entries(opts.inlineImages)) {
		cidMap.set(cid, `data:${img.mimeType};base64,${bytesToBase64(img.data)}`);
	}

	const onAttribute = (node: Element, data: UponSanitizeAttributeHookEvent) => {
		const name = data.attrName.toLowerCase();
		const tag = node.tagName ? node.tagName.toLowerCase() : '';

		if (name === 'src' && tag === 'img') {
			const v = data.attrValue.trim();
			if (/^cid:/i.test(v)) {
				const cid = v.slice(4).replace(/^<|>$/g, '');
				const resolved = cidMap.get(cid);
				if (resolved) {
					data.attrValue = resolved;
				} else {
					data.keepAttr = false;
				}
				return;
			}
			if (/^data:image\//i.test(v)) return;
			if (/^https?:/i.test(v)) {
				data.keepAttr = false;
				return;
			}
			data.keepAttr = false;
			return;
		}

		if (name === 'href' && tag === 'a') {
			const v = data.attrValue.trim();
			if (/^javascript:/i.test(v) || /^vbscript:/i.test(v) || /^data:/i.test(v)) {
				data.keepAttr = false;
			}
			return;
		}

		if (name === 'style') {
			data.attrValue = scrubCss(data.attrValue);
		}
	};

	const onAfterAttributes = (node: Element) => {
		if (node.tagName === 'A' && node.hasAttribute('href')) {
			if (opts.stripTracking !== false) {
				const href = node.getAttribute('href') ?? '';
				const cleaned = stripTrackingParams(href);
				if (cleaned !== href) node.setAttribute('href', cleaned);
			}
			node.setAttribute('target', '_blank');
			node.setAttribute('rel', 'noopener noreferrer');
		}
	};

	DOMPurify.addHook('uponSanitizeAttribute', onAttribute);
	DOMPurify.addHook('afterSanitizeAttributes', onAfterAttributes);
	let clean: string;
	try {
		clean = DOMPurify.sanitize(pre, {
			FORCE_BODY: true,
			FORBID_TAGS,
			FORBID_ATTR,
			ALLOWED_URI_REGEXP,
			ALLOW_UNKNOWN_PROTOCOLS: false
		}) as unknown as string;
	} finally {
		DOMPurify.removeHook('uponSanitizeAttribute', onAttribute);
		DOMPurify.removeHook('afterSanitizeAttributes', onAfterAttributes);
	}

	return clean;
}
