import { apiFetch } from './client';
import { ApiCallError } from './types';

interface BimiLogoResponse {
	svg: string;
}

export async function fetchBimiLogo(domain: string): Promise<string | null> {
	try {
		const res = await apiFetch<BimiLogoResponse>(`/v1/bimi/${encodeURIComponent(domain)}`);
		return typeof res?.svg === 'string' && res.svg ? res.svg : null;
	} catch (err) {
		if (err instanceof ApiCallError && err.status === 404) return null;
		throw err;
	}
}
