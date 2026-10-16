import { vi } from 'vitest';

vi.mock('$env/static/public', () => ({
	PUBLIC_API_BASE_URL: 'https://api.test.thelemail.local',
	PUBLIC_SUBMISSION_BASE_URL: 'https://submit.test.thelemail.local',
	PUBLIC_OFFICIAL_SENDER_POLICY: JSON.stringify({
		addresses: ['no-reply@thel.email'],
		keys: ['-----BEGIN PGP PUBLIC KEY BLOCK-----\ntest\n-----END PGP PUBLIC KEY BLOCK-----'],
		fingerprints: ['6f5c52377a17d88b770cb6efbe39880b6d7b050ff4f4b88d401e320f4c268b6a'],
		displayName: 'Thelemail'
	})
}));

vi.mock('$app/environment', () => ({
	browser: true,
	dev: true,
	building: false,
	version: 'test'
}));

if (typeof window !== 'undefined' && !window.matchMedia) {
	window.matchMedia = (query: string) =>
		({
			matches: false,
			media: query,
			onchange: null,
			addEventListener: () => {},
			removeEventListener: () => {},
			addListener: () => {},
			removeListener: () => {},
			dispatchEvent: () => false
		}) as unknown as MediaQueryList;
}
