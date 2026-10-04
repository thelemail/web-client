import type { ParamMatcher } from '@sveltejs/kit';
import { isMailFolderRoute } from '$core/mail/folderRoute';

export const match = ((p) => isMailFolderRoute(p)) satisfies ParamMatcher;
