import DOMPurify from 'dompurify';
import { scrubCss } from './sanitizeHtml';
import { SIGNATURE_IMAGE_ATTR } from '../editor/signatureImage';

const ALLOWED_URI_REGEXP = /^(?:(?:https?|mailto|tel|cid):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

const FORBID_TAGS = [
	'script',
	'iframe',
	'object',
	'embed',
	'form',
	'style',
	'link',
	'meta',
	'base',
	'svg',
	'math'
];

const FORBID_ATTR = ['srcset', 'formaction', 'ping', 'background'];

export interface SanitizeSignatureOptions {
	keepRemoteImages?: boolean;
}

export function sanitizeSignatureHtml(html: string, opts: SanitizeSignatureOptions = {}): string {
	if (!html) return '';
	const purify = DOMPurify;

	const onAttr = (node: Element, data: { attrName: string; attrValue: string; keepAttr: boolean }) => {
		if (data.attrName === 'style') {
			data.attrValue = scrubCss(data.attrValue);
			return;
		}
		if (data.attrName === 'href') {
			if (/^\s*(javascript|data|vbscript):/i.test(data.attrValue)) data.keepAttr = false;
			return;
		}
		if (data.attrName === 'src' && node.tagName === 'IMG') {
			const marked = node.hasAttribute(SIGNATURE_IMAGE_ATTR);
			if (marked) return;
			if (opts.keepRemoteImages && /^https?:/i.test(data.attrValue)) return;
			if (/^cid:/i.test(data.attrValue)) return;
			if (/^data:image\//i.test(data.attrValue) && opts.keepRemoteImages) return;
			data.keepAttr = false;
		}
	};

	purify.addHook('uponSanitizeAttribute', onAttr as never);
	let clean: string;
	try {
		clean = purify.sanitize(html, {
			FORBID_TAGS,
			FORBID_ATTR,
			ALLOWED_URI_REGEXP,
			ALLOW_DATA_ATTR: true,
			WHOLE_DOCUMENT: false,
			RETURN_TRUSTED_TYPE: false
		}) as string;
	} finally {
		purify.removeHook('uponSanitizeAttribute');
	}

	if (typeof DOMParser === 'undefined') return clean;
	const doc = new DOMParser().parseFromString(`<div>${clean}</div>`, 'text/html');
	const wrapper = doc.body.firstElementChild as HTMLElement | null;
	if (!wrapper) return clean;
	for (const img of Array.from(wrapper.querySelectorAll('img'))) {
		if (img.hasAttribute(SIGNATURE_IMAGE_ATTR)) {
			img.setAttribute('src', '');
			continue;
		}
		const src = img.getAttribute('src') ?? '';
		const keepable =
			(opts.keepRemoteImages && (/^https?:/i.test(src) || /^data:image\//i.test(src))) ||
			/^cid:/i.test(src);
		if (!keepable) img.remove();
	}
	return wrapper.innerHTML;
}
