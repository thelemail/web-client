import { defineParams } from '@sveltejs/kit/params';

export const params = defineParams({
	accountSlot: (param) => (/^\d+$/.test(param) ? param : undefined)
});
