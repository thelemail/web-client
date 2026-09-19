import type { HandleClientError } from '@sveltejs/kit';
import { m } from '$paraglide/messages.js';

export const handleError: HandleClientError = ({ error, status }) => {
	console.error(error);
	if (status === 404) {
		return { message: m.app_error_not_found_message() };
	}
	return { message: m.app_error_default_message() };
};
