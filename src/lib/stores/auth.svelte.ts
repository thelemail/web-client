import { browser } from '$app/environment';
import { invalidateAll } from '$app/navigation';
import { registerAuthRouter, registerLifecycleReconciler } from '$lib/api/client';
import {
	refreshSession,
	logout as apiLogout,
	logoutAll as apiLogoutAll,
	getMe,
	getPersistentHalf
} from '$lib/api/auth';
import { ApiCallError, type DeletionStatus, type LifecycleInfo, type MeResponse } from '$lib/api/types';
import { keystore } from '$lib/keystore/keystore-client';
import type { StatusResponse } from '$lib/keystore/protocol';
import { accounts } from './accounts.svelte';
import { mailbox } from './mailbox.svelte';
import { drafts } from './drafts.svelte';
import { scheduled } from './scheduled.svelte';
import { addresses } from './addresses.svelte';
import { syncAddressUids } from '$lib/keys/uid-sync';
import { signatures } from './signatures.svelte';
import { customDomains } from './customDomains.svelte';
import { accountSettings } from './accountSettings.svelte';
import { workspaces } from './workspaces.svelte';
import { composeStore } from './compose.svelte';
import { preferences } from './preferences.svelte';
import { billing } from './billing.svelte';
import { twofactor } from './twofactor.svelte';
import { bimi } from './bimi.svelte';
import { contacts } from './contacts.svelte';
import { realtime } from '$lib/realtime/realtime.svelte';

function broadcastAccountToStores(accountId: string | null): void {
	mailbox.setAccount(accountId);
	contacts.setAccount(accountId);
	drafts.setAccount(accountId);
	scheduled.setAccount(accountId);
	addresses.setAccount(accountId);
	signatures.setAccount(accountId);
	customDomains.setAccount(accountId);
	accountSettings.setAccount(accountId);
	workspaces.setAccount(accountId);
	billing.setAccount(accountId);
	composeStore.setAccount(accountId);
	preferences.setAccount(accountId);
	twofactor.setAccount(accountId);
	bimi.setAccount(accountId);
}

const REFRESH_SKEW_MS = 60_000;

interface TokenSlot {
	accessToken: string;
	accessTokenExpiresAt: number;
}

interface ProfileSnapshot {
	email: string | null;
	fullName: string | null;
	avatarUrl: string | null;
	defaultReplyAddressId: string | null;
	hasPersistent: boolean;
	vaultUnlocked: boolean;
	recoveryEnabled: boolean | null;
	deletion: DeletionStatus | null;
	lifecycle: LifecycleInfo | null;
}

const emptyProfile = (): ProfileSnapshot => ({
	email: null,
	fullName: null,
	avatarUrl: null,
	defaultReplyAddressId: null,
	hasPersistent: false,
	vaultUnlocked: false,
	recoveryEnabled: null,
	deletion: null,
	lifecycle: null
});

class AuthStore {
	#tokens = $state(new Map<string, TokenSlot>());
	#profiles = $state(new Map<string, ProfileSnapshot>());
	#currentId = $state<string | null>(null);
	#refreshing = new Map<string, Promise<boolean>>();
	#refreshTimer: ReturnType<typeof setTimeout> | null = null;

	accessToken = $derived<string | null>(this.#tokens.get(this.#currentId ?? '')?.accessToken ?? null);
	accessTokenExpiresAt = $derived<number | null>(
		this.#tokens.get(this.#currentId ?? '')?.accessTokenExpiresAt ?? null
	);
	accountId = $derived<string | null>(this.#currentId);
	email = $derived<string | null>(this.#currentProfile().email);
	fullName = $derived<string | null>(this.#currentProfile().fullName);
	avatarUrl = $derived<string | null>(this.#currentProfile().avatarUrl);
	defaultReplyAddressId = $derived<string | null>(
		this.#currentProfile().defaultReplyAddressId
	);
	vaultUnlocked = $derived<boolean>(this.#currentProfile().vaultUnlocked);
	hasPersistent = $derived<boolean>(this.#currentProfile().hasPersistent);
	recoveryEnabled = $derived<boolean | null>(this.#currentProfile().recoveryEnabled);
	deletion = $derived<DeletionStatus | null>(this.#currentProfile().deletion);
	lifecycle = $derived<LifecycleInfo | null>(this.#currentProfile().lifecycle);

	isAuthenticated = $derived(
		this.accessToken !== null && (this.accessTokenExpiresAt ?? 0) > Date.now()
	);
	canEnterApp = $derived(this.isAuthenticated && this.vaultUnlocked);

	#subscribed = false;

	#currentProfile(): ProfileSnapshot {
		const id = this.#currentId;
		if (!id) return emptyProfile();
		return this.#profiles.get(id) ?? emptyProfile();
	}

	#getOrCreateProfile(accountId: string): ProfileSnapshot {
		const existing = this.#profiles.get(accountId);
		if (existing) return existing;
		this.#mutateProfile(accountId, (p) => p);
		return this.#profiles.get(accountId) ?? emptyProfile();
	}

	#mutateProfile(accountId: string, fn: (p: ProfileSnapshot) => ProfileSnapshot): void {
		const existing = this.#profiles.get(accountId) ?? emptyProfile();
		const next = fn(existing);
		const m = new Map(this.#profiles);
		m.set(accountId, next);
		this.#profiles = m;
	}

	syncFromKeystoreStatus(status: StatusResponse): void {
		for (const a of status.accounts) {
			this.#mutateProfile(a.accountId, (p) => ({
				...p,
				email: a.email,
				vaultUnlocked: a.unlocked,
				hasPersistent: a.hasPersistent
			}));
		}
	}

	async ensureVaultUnlocked(accountId: string): Promise<boolean> {
		const status = await keystore.status();
		this.syncFromKeystoreStatus(status);
		const acct = status.accounts.find((a) => a.accountId === accountId);
		if (acct?.unlocked) return true;
		if (!acct?.hasPersistent) return false;
		try {
			const { serverHalf } = await getPersistentHalf(accountId);
			const restored = await keystore.tryRestoreFromPersistent({ accountId, serverHalf });
			if (!restored.ok) {
				await keystore.disablePersistent({ accountId });
				return false;
			}
			this.#mutateProfile(accountId, (p) => ({
				...p,
				vaultUnlocked: true,
				email: restored.email ?? p.email
			}));
			void syncAddressUids(accountId);
			return true;
		} catch (err) {
			if (err instanceof ApiCallError && err.status === 401) {
				await keystore.disablePersistent({ accountId });
			}
			return false;
		}
	}

	async hydrate(): Promise<void> {
		if (!browser) return;
		this.subscribeOnce();
		await accounts.load();
		const s = await keystore.status();
		this.syncFromKeystoreStatus(s);
		if (!this.#currentId) {
			const fallback = accounts.lastActiveSlot;
			if (fallback !== null) {
				const rec = accounts.bySlot(fallback);
				if (rec) this.#currentId = rec.accountId;
			} else if (s.accounts[0]) {
				this.#currentId = s.accounts[0].accountId;
			}
		}
	}

	subscribeOnce(): void {
		if (this.#subscribed) return;
		this.#subscribed = true;
		keystore.subscribe((msg) => {
			if (msg.type === 'vaultChanged') {
				this.#mutateProfile(msg.accountId, (p) => ({
					...p,
					email: msg.email,
					vaultUnlocked: true
				}));
			} else if (msg.type === 'locked') {
				this.#mutateProfile(msg.accountId, (p) => ({ ...p, vaultUnlocked: false }));
				this.#dropToken(msg.accountId);
			} else if (msg.type === 'cleared') {
				this.#dropToken(msg.accountId);
				const m = new Map(this.#profiles);
				m.delete(msg.accountId);
				this.#profiles = m;
				if (this.#currentId === msg.accountId) this.#currentId = null;
			} else if (msg.type === 'clearedAll') {
				this.#tokens = new Map();
				this.#profiles = new Map();
				this.#currentId = null;
			} else if (msg.type === 'persistentDisabled') {
				this.#mutateProfile(msg.accountId, (p) => ({ ...p, hasPersistent: false }));
			}
		});
	}

	activate(accountId: string): void {
		this.#currentId = accountId;
		broadcastAccountToStores(accountId);
		this.#scheduleProactiveRefresh();
		void accounts.touch(accountId);
	}

	#dropToken(accountId: string): void {
		if (!this.#tokens.has(accountId)) return;
		const m = new Map(this.#tokens);
		m.delete(accountId);
		this.#tokens = m;
	}

	addSession(accessToken: string, expiresInSeconds: number, accountId: string): void {
		const m = new Map(this.#tokens);
		m.set(accountId, {
			accessToken,
			accessTokenExpiresAt: Date.now() + expiresInSeconds * 1000
		});
		this.#tokens = m;
		this.#getOrCreateProfile(accountId);
		if (accountId === this.#currentId) this.#scheduleProactiveRefresh();
	}

	setSession(accessToken: string, expiresInSeconds: number, accountId: string): void {
		this.addSession(accessToken, expiresInSeconds, accountId);
		this.activate(accountId);
	}

	getAccessToken(accountId: string | null): string | null {
		if (!accountId) return this.#tokens.get(this.#currentId ?? '')?.accessToken ?? null;
		return this.#tokens.get(accountId)?.accessToken ?? null;
	}

	async tryRefresh(accountId?: string): Promise<boolean> {
		const id = accountId ?? this.#currentId;
		if (!id) return false;
		const inflight = this.#refreshing.get(id);
		if (inflight) return inflight;
		const p = (async () => {
			try {
				const res = await refreshSession(id);
				this.addSession(res.accessToken, res.expiresInSeconds, res.accountId);
				return true;
			} catch {
				return false;
			}
		})();
		this.#refreshing.set(id, p);
		try {
			return await p;
		} finally {
			this.#refreshing.delete(id);
		}
	}

	async ensureFreshToken(accountId: string | null): Promise<void> {
		const id = accountId ?? this.#currentId;
		if (!id) return;
		const slot = this.#tokens.get(id);
		if (slot && slot.accessTokenExpiresAt - REFRESH_SKEW_MS > Date.now()) return;
		await this.tryRefresh(id);
	}

	#scheduleProactiveRefresh(): void {
		if (!browser) return;
		if (this.#refreshTimer) {
			clearTimeout(this.#refreshTimer);
			this.#refreshTimer = null;
		}
		const id = this.#currentId;
		if (!id) return;
		const slot = this.#tokens.get(id);
		if (!slot) return;
		const delay = Math.max(0, slot.accessTokenExpiresAt - Date.now() - REFRESH_SKEW_MS);
		this.#refreshTimer = setTimeout(() => {
			void this.ensureFreshToken(id);
		}, delay);
	}

	wake(): void {
		void this.ensureFreshToken(this.#currentId);
		realtime.wake();
	}

	async loadProfile(accountId?: string): Promise<boolean> {
		const id = accountId ?? this.#currentId;
		if (!id) return false;
		try {
			const me = await getMe(id);
			this.applyMe(me);
			return true;
		} catch {
			return false;
		}
	}

	applyMe(me: MeResponse): void {
		const id = me.accountId;
		this.#mutateProfile(id, (p) => ({
			...p,
			email: me.email,
			fullName: me.fullName,
			avatarUrl: me.avatarUrl ?? null,
			defaultReplyAddressId: me.defaultReplyAddressId ?? null,
			recoveryEnabled: me.recoveryEnabled ?? null,
			deletion: me.deletion ?? null,
			lifecycle: me.lifecycle ?? null
		}));
	}

	deletionFor(accountId: string): DeletionStatus | null {
		return this.#profiles.get(accountId)?.deletion ?? null;
	}

	lifecycleFor(accountId: string): LifecycleInfo | null {
		return this.#profiles.get(accountId)?.lifecycle ?? null;
	}

	async logoutAccount(accountId: string): Promise<void> {
		try {
			await apiLogout(accountId);
		} catch {
		}
		this.#dropToken(accountId);
		await keystore.clear({ accountId });
		await accounts.remove(accountId);
		const m = new Map(this.#profiles);
		m.delete(accountId);
		this.#profiles = m;
		if (this.#currentId === accountId) {
			this.#currentId = null;
			broadcastAccountToStores(null);
		}
	}

	async logout(): Promise<void> {
		const id = this.#currentId;
		if (id) await this.logoutAccount(id);
	}

	async logoutAll(): Promise<void> {
		try {
			await apiLogoutAll();
		} catch {
		}
		this.#tokens = new Map();
		await keystore.clearAll();
		await accounts.clear();
		this.#profiles = new Map();
		this.#currentId = null;
		broadcastAccountToStores(null);
	}
}

export const auth = new AuthStore();

if (browser) {
	registerAuthRouter({
		currentAccountId: () => auth.accountId,
		getAccessToken: (accountId) => auth.getAccessToken(accountId),
		ensureFreshToken: (accountId) => auth.ensureFreshToken(accountId),
		onUnauthorized: (accountId) => auth.tryRefresh(accountId ?? undefined)
	});

	registerLifecycleReconciler({
		onLifecycleError: (_code, accountId) => {
			void (async () => {
				if (accountId) await auth.loadProfile(accountId);
				await invalidateAll();
			})();
		}
	});

	const wake = () => auth.wake();
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') wake();
	});
	window.addEventListener('focus', wake);
	window.addEventListener('online', wake);
}
