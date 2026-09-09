import { Node, mergeAttributes } from '@tiptap/core';
import { signatures } from '$lib/stores/signatures.svelte';

export const SIGNATURE_IMAGE_ATTR = 'data-thelemail-sig-image';

export const SignatureImage = Node.create({
	name: 'signatureImage',
	inline: true,
	group: 'inline',
	atom: true,
	draggable: false,

	addAttributes() {
		return {
			objectKey: {
				default: null,
				parseHTML: (el: HTMLElement) => el.getAttribute(SIGNATURE_IMAGE_ATTR),
				renderHTML: (attrs: Record<string, unknown>) => {
					const key = attrs.objectKey;
					if (!key) return {};
					return { [SIGNATURE_IMAGE_ATTR]: key as string };
				}
			},
			alt: {
				default: '',
				parseHTML: (el: HTMLElement) => el.getAttribute('alt') ?? '',
				renderHTML: (attrs: Record<string, unknown>) => ({ alt: (attrs.alt as string) ?? '' })
			},
			width: {
				default: null,
				parseHTML: (el: HTMLElement) => el.getAttribute('width'),
				renderHTML: (attrs: Record<string, unknown>) =>
					attrs.width ? { width: attrs.width as string } : {}
			}
		};
	},

	parseHTML() {
		return [{ tag: `img[${SIGNATURE_IMAGE_ATTR}]` }];
	},

	renderHTML({ HTMLAttributes }) {
		return ['img', mergeAttributes(HTMLAttributes, { src: '', class: 'sig-img' })];
	},

	addNodeView() {
		return ({ node }) => {
			const dom = document.createElement('img');
			dom.className = 'sig-img';
			dom.alt = (node.attrs.alt as string) ?? '';
			if (node.attrs.width) dom.setAttribute('width', node.attrs.width as string);
			const key = node.attrs.objectKey as string | null;
			if (key) {
				dom.setAttribute(SIGNATURE_IMAGE_ATTR, key);
				const cached = signatures.objectUrl(key);
				if (cached) {
					dom.src = cached;
				} else {
					void signatures
						.ensureObjectUrl(key)
						.then((url) => {
							dom.src = url;
						})
						.catch(() => {
							dom.dataset.failed = '1';
						});
				}
			}
			return { dom };
		};
	}
});
