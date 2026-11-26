import { Node, mergeAttributes } from '@tiptap/core';
import { SIGNATURE_ATTR } from './signatureAttrs';

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
