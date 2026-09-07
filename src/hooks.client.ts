import type { HandleClientError } from '@sveltejs/kit';

export const handleError: HandleClientError = ({ error, status }) => {
	console.error(error);
	if (status === 404) {
		return { message: 'That page does not exist.' };
	}
	return { message: 'Something went wrong loading this page.' };
};
