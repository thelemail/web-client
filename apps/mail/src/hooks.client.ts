import type { HandleClientError } from '@sveltejs/kit/hooks';
import { m } from '$paraglide/messages.js';

export const handleError: HandleClientError = ({ kind, error }) => {
	console.error(error);
	if (kind !== 'unknown' && error.status === 404) {
		return { message: m.app_error_not_found_message() };
	}
	return { message: m.app_error_default_message() };
};
