import { loadEnv } from 'vite';

export function loadBuildEnv(): Record<string, string> {
	return loadEnv('production', '.', ['PUBLIC_', 'CSP_']);
}

function originOf(value: string, name: string): string {
	try {
		return new URL(value).origin;
	} catch {
		throw new Error(`${name} is not a valid absolute URL: ${JSON.stringify(value)}`);
	}
}

export function resolveOrigins(env: Record<string, string | undefined>): string[] {
	const required: Record<string, string | undefined> = {
		PUBLIC_API_BASE_URL: env.PUBLIC_API_BASE_URL,
		PUBLIC_SUBMISSION_BASE_URL: env.PUBLIC_SUBMISSION_BASE_URL,
		CSP_BLOB_ORIGIN: env.CSP_BLOB_ORIGIN
	};

	const missing = Object.entries(required)
		.filter(([, value]) => !value)
		.map(([name]) => name);

	if (missing.length > 0) {
		throw new Error(
			`Missing required build configuration: ${missing.join(', ')}. ` +
				'Every origin the client may contact has to be declared so it can enter the Content-Security-Policy. ' +
				'See .env.example.'
		);
	}

	const origins = new Set<string>();
	for (const [name, value] of Object.entries(required)) {
		for (const item of String(value).split(/\s+/).filter(Boolean)) {
			origins.add(originOf(item, name));
		}
	}
	return [...origins];
}

export function inlineScriptHashes(html: string): string[] {
	return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
		(match) => match[1]
	);
}
