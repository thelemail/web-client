import { Node, mergeAttributes } from '@tiptap/core';

export const SIGNATURE_ATTR = 'data-thelemail-signature';

export const SignatureBlock = Node.create({
	name: 'signatureBlock',
	group: 'block',
	content: 'block+',
	defining: true,
	parseHTML() {
		return [{ tag: `div[${SIGNATURE_ATTR}]` }];
	},
	renderHTML({ HTMLAttributes }) {
		return ['div', mergeAttributes(HTMLAttributes, { [SIGNATURE_ATTR]: '1' }), 0];
	}
});
