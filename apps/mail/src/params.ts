import { defineParams } from '@sveltejs/kit/params';
import { isMailFolderRoute } from '../../../packages/core/src/mail/folderRoute.ts';

export const params = defineParams({
	accountSlot: (param) => (/^\d+$/.test(param) ? param : undefined),
	systemFolder: (param) => (isMailFolderRoute(param) ? param : undefined)
});
