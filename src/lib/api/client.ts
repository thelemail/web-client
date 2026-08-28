import { PUBLIC_API_BASE_URL, PUBLIC_SUBMISSION_BASE_URL } from '$env/static/public';
import { deviceId } from '$lib/realtime/device';
import { ApiCallError, type ErrorEnvelope } from './types';

export interface AuthRouter {
	currentAccountId(): string | null;
	getAccessToken(accountId: string | null): string | null;
	ensureFreshToken?(accountId: string | null): Promise<void>;
	onUnauthorized(accountId: string | null): Promise<boolean>;
}

let authRouter: AuthRouter | null = null;

export function registerAuthRouter(r: AuthRouter) {
	authRouter = r;
}

export interface AuthTokenSource {
	getAccessToken(): string | null;
	onUnauthorized(): Promise<boolean>;
}

export function registerAuthTokenSource(src: AuthTokenSource) {
	registerAuthRouter({
		currentAccountId: () => null,
		getAccessToken: () => src.getAccessToken(),
		onUnauthorized: () => src.onUnauthorized()
	});
}

export interface LifecycleReconciler {
	onLifecycleError(code: 'read_only' | 'account_suspended', accountId: string | null): void;
}

let lifecycleReconciler: LifecycleReconciler | null = null;

export function registerLifecycleReconciler(r: LifecycleReconciler) {
	lifecycleReconciler = r;
}

interface FetchOptions {
	method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
	body?: unknown;
	skipAuth?: boolean;
	skipRetryOnUnauthorized?: boolean;
	baseUrl?: string;
	accountId?: string;
	headers?: Record<string, string>;
}

export async function apiFetch<T>(path: string, opts: FetchOptions = {}): Promise<T> {
	return doFetch<T>(path, opts, false);
}

export async function submissionFetch<T>(path: string, opts: FetchOptions = {}): Promise<T> {
	return doFetch<T>(path, { ...opts, baseUrl: PUBLIC_SUBMISSION_BASE_URL }, false);
}

function resolveAccountId(explicit: string | undefined): string | null {
	if (explicit) return explicit;
	return authRouter?.currentAccountId() ?? null;
}

async function doFetch<T>(path: string, opts: FetchOptions, retried: boolean): Promise<T> {
	const base = (opts.baseUrl ?? PUBLIC_API_BASE_URL).replace(/\/$/, '');
	const url = base + path;
	const headers: Record<string, string> = { ...opts.headers };
	const init: RequestInit = {
		method: opts.method ?? 'GET',
		credentials: 'include',
		headers
	};
	if (opts.body !== undefined) {
		headers['Content-Type'] = 'application/json';
		init.body = JSON.stringify(opts.body);
	}
	const accountId = resolveAccountId(opts.accountId);
	if (accountId) {
		headers['X-Account-Id'] = accountId;
	}
	headers['X-Device-Id'] = deviceId();
	if (!opts.skipAuth && authRouter) {
		await authRouter.ensureFreshToken?.(accountId);
		const token = authRouter.getAccessToken(accountId);
		if (token) {
			headers['Authorization'] = `Bearer ${token}`;
		}
	}

	const resp = await fetch(url, init);
	if (resp.status === 204) {
		return undefined as T;
	}
	const contentType = resp.headers.get('content-type') ?? '';
	const body = contentType.includes('application/json') ? await resp.json() : null;
	if (resp.ok) {
		return body as T;
	}
	if (
		resp.status === 401 &&
		!retried &&
		!opts.skipRetryOnUnauthorized &&
		!opts.skipAuth &&
		authRouter
	) {
		const refreshed = await authRouter.onUnauthorized(accountId);
		if (refreshed) {
			return doFetch<T>(path, opts, true);
		}
	}
	const code = (body as ErrorEnvelope)?.error?.code;
	if ((code === 'read_only' || code === 'account_suspended') && lifecycleReconciler) {
		lifecycleReconciler.onLifecycleError(code, accountId);
	}
	throw new ApiCallError(
		resp.status,
		(body as ErrorEnvelope) ?? null,
		(body as ErrorEnvelope)?.error?.message ?? `HTTP ${resp.status}`
	);
}
