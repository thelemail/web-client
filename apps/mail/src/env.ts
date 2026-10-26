import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	PUBLIC_API_BASE_URL: { public: true, static: true },
	PUBLIC_SUBMISSION_BASE_URL: { public: true, static: true },
	PUBLIC_DIRECTORY_SIGNING_PUBLIC_KEY_ARMORED: { public: true, static: true },
	PUBLIC_OFFICIAL_SENDER_POLICY: { public: true, static: true },
	PUBLIC_TLOG_POLICY: { public: true, static: true, schema: (value) => value }
});
