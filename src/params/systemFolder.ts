import type { ParamMatcher } from '@sveltejs/kit';

const SYSTEM_FOLDERS = new Set([
	'inbox',
	'starred',
	'sent',
	'drafts',
	'scheduled',
	'snoozed',
	'archive',
	'spam',
	'trash'
]);

export const match = ((p) => SYSTEM_FOLDERS.has(p)) satisfies ParamMatcher;
