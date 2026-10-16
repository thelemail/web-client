import { PUBLIC_API_BASE_URL, PUBLIC_SUBMISSION_BASE_URL } from '$env/static/public';
import { platform } from '$platform';
import { deviceId } from '$core/realtime/device';
import type { Transport } from '$core/platform/types';
import { ApiCallError, type ErrorEnvelope } from './types';
import { recordServerDate } from './serverclock';

let transport: Transport = platform.transport ?? ((url, init) => fetch(url, init));

export function registerTransport(t: Transport) {
	transport = t;
}

export interface AuthRouter {
	currentAccountId(): string | null;
	getAccessToken(accountId: string | null): string | null;
	ensureFreshToken?(accountId: string | null): Promise<void>;
	isSessionLost?(accountId: string | null): boolean;
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

export type ReauthHandler = (accountId: string) => Promise<boolean>;

let reauthHandler: ReauthHandler | null = null;

export function registerReauthHandler(h: ReauthHandler | null) {
	reauthHandler = h;
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
	skipReauth?: boolean;
	baseUrl?: string;
	accountId?: string;
	headers?: Record<string, string>;
	keepalive?: boolean;
}

export async function apiFetch<T>(path: string, opts: FetchOptions = {}): Promise<T> {
	return doFetch<T>(path, opts, false, false);
}

export async function submissionFetch<T>(path: string, opts: FetchOptions = {}): Promise<T> {
	return doFetch<T>(path, { ...opts, baseUrl: PUBLIC_SUBMISSION_BASE_URL }, false, false);
}

export interface UploadOptions {
	signal?: AbortSignal;
	onProgress?: (fraction: number) => void;
	accountId?: string;
}

export async function submissionUpload<T>(
	path: string,
	body: Blob,
	contentType: string,
	opts: UploadOptions = {},
	retried = false
): Promise<T> {
	const base = PUBLIC_SUBMISSION_BASE_URL.replace(/\/$/, '');
	if (!path.startsWith('/') || path.startsWith('//')) {
		throw new Error('submission upload path must be relative to the submission origin');
	}
	const accountId = resolveAccountId(opts.accountId);
	const headers = { 'Content-Type': contentType, ...(await authHeaders(accountId, true)) };
	const resp = await platform.submissionUpload(base + path, body, headers, {
		signal: opts.signal,
		onProgress: opts.onProgress
	});
	recordServerDate(resp.headers.get('date'));
	const parsed = (resp.headers.get('content-type') ?? '').includes('application/json')
		? await resp.json()
		: null;
	if (resp.ok) return parsed as T;
	if (resp.status === 401 && !retried && authRouter && (await authRouter.onUnauthorized(accountId))) {
		return submissionUpload<T>(path, body, contentType, opts, true);
	}
	throw new ApiCallError(
		resp.status,
		(parsed as ErrorEnvelope) ?? null,
		(parsed as ErrorEnvelope)?.error?.message ?? `HTTP ${resp.status}`
	);
}

function resolveAccountId(explicit: string | undefined): string | null {
	if (explicit) return explicit;
	return authRouter?.currentAccountId() ?? null;
}

async function authHeaders(accountId: string | null, withAuth: boolean): Promise<Record<string, string>> {
	const headers: Record<string, string> = { 'X-Device-Id': deviceId() };
	if (accountId) headers['X-Account-Id'] = accountId;
	if (withAuth && authRouter) {
		if (authRouter.isSessionLost?.(accountId)) throw new ApiCallError(401, null, 'HTTP 401');
		await authRouter.ensureFreshToken?.(accountId);
		const token = authRouter.getAccessToken(accountId);
		if (token) headers['Authorization'] = `Bearer ${token}`;
	}
	return headers;
}

export function apiUrl(path: string): string {
	if (!path.startsWith('/') || path.startsWith('//')) {
		throw new Error('api path must be relative to the api origin');
	}
	return PUBLIC_API_BASE_URL.replace(/\/$/, '') + path;
}

export function blobRequestHeaders(accountId?: string): Promise<Record<string, string>> {
	return authHeaders(resolveAccountId(accountId), true);
}

async function errorFrom(resp: Response): Promise<ApiCallError> {
	const parsed = (resp.headers.get('content-type') ?? '').includes('application/json')
		? ((await resp.json().catch(() => null)) as ErrorEnvelope | null)
		: null;
	return new ApiCallError(resp.status, parsed, parsed?.error?.message ?? `HTTP ${resp.status}`);
}

export interface BlobFetchOptions {
	accountId?: string;
	signal?: AbortSignal;
}

export async function apiBlobFetch(path: string, opts: BlobFetchOptions = {}, retried = false): Promise<Response> {
	const accountId = resolveAccountId(opts.accountId);
	const headers = await authHeaders(accountId, true);
	const resp = await transport(
		apiUrl(path),
		{ method: 'GET', credentials: 'include', headers, signal: opts.signal },
		'api'
	);
	recordServerDate(resp.headers.get('date'));
	if (resp.ok) return resp;
	if (resp.status === 401 && !retried && authRouter && (await authRouter.onUnauthorized(accountId))) {
		return apiBlobFetch(path, opts, true);
	}
	throw await errorFrom(resp);
}

const blobPutRetryable = new Set([429, 503]);
const blobPutAttempts = 5;

function retryDelay(resp: Response, attempt: number): number {
	const after = Number(resp.headers.get('retry-after'));
	if (Number.isFinite(after) && after > 0) return Math.min(after, 30) * 1000;
	return Math.min(1000 * 2 ** attempt, 8000);
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(new DOMException('aborted', 'AbortError'));
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener(
			'abort',
			() => {
				clearTimeout(timer);
				reject(new DOMException('aborted', 'AbortError'));
			},
			{ once: true }
		);
	});
}

export async function apiBlobPut(path: string, body: Blob, opts: UploadOptions = {}): Promise<void> {
	const accountId = resolveAccountId(opts.accountId);
	const url = apiUrl(path);
	let refreshed = false;
	for (let attempt = 0; ; attempt++) {
		const headers = {
			'Content-Type': 'application/octet-stream',
			...(await authHeaders(accountId, true))
		};
		const resp = await platform.blobPut(url, body, headers, {
			signal: opts.signal,
			onProgress: opts.onProgress
		});
		recordServerDate(resp.headers.get('date'));
		if (resp.ok) return;
		if (resp.status === 401 && !refreshed && authRouter && (await authRouter.onUnauthorized(accountId))) {
			refreshed = true;
			continue;
		}
		if (blobPutRetryable.has(resp.status) && attempt + 1 < blobPutAttempts) {
			await pause(retryDelay(resp, attempt), opts.signal);
			continue;
		}
		throw await errorFrom(resp);
	}
}

async function doFetch<T>(
	path: string,
	opts: FetchOptions,
	retried: boolean,
	reauthed: boolean
): Promise<T> {
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
	if (opts.keepalive) init.keepalive = true;
	const accountId = resolveAccountId(opts.accountId);
	Object.assign(headers, await authHeaders(accountId, !opts.skipAuth));

	const kind = base === PUBLIC_SUBMISSION_BASE_URL.replace(/\/$/, '') ? 'submission' : 'api';
	const resp = await transport(url, init, kind);
	recordServerDate(resp.headers.get('date'));
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
			return doFetch<T>(path, opts, true, reauthed);
		}
	}
	const code = (body as ErrorEnvelope)?.error?.code;
	if (
		code === 'reauthentication_required' &&
		!reauthed &&
		!opts.skipReauth &&
		!opts.skipAuth &&
		accountId &&
		reauthHandler &&
		(await reauthHandler(accountId))
	) {
		return doFetch<T>(path, opts, retried, true);
	}
	if ((code === 'read_only' || code === 'account_suspended') && lifecycleReconciler) {
		lifecycleReconciler.onLifecycleError(code, accountId);
	}
	throw new ApiCallError(
		resp.status,
		(body as ErrorEnvelope) ?? null,
		(body as ErrorEnvelope)?.error?.message ?? `HTTP ${resp.status}`
	);
}
