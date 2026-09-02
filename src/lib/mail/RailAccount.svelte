<script lang="ts">
	import User from '@lucide/svelte/icons/user';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import AtSign from '@lucide/svelte/icons/at-sign';
	import Settings from '@lucide/svelte/icons/settings';
	import Sun from '@lucide/svelte/icons/sun';
	import Moon from '@lucide/svelte/icons/moon';
	import Monitor from '@lucide/svelte/icons/monitor';
	import LogOut from '@lucide/svelte/icons/log-out';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import ArrowLeftRight from '@lucide/svelte/icons/arrow-left-right';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import LogIn from '@lucide/svelte/icons/log-in';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import Check from '@lucide/svelte/icons/check';
	import X from '@lucide/svelte/icons/x';
	import { ChevronDown, ChevronUp } from 'lucide';
	import NavMorph from '$lib/components/NavMorph.svelte';
	import Avatar from './Avatar.svelte';
	import RemoveAccountDialog from './RemoveAccountDialog.svelte';
	import logoMark from '$lib/assets/logo-mark.svg';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { auth } from '$lib/stores/auth.svelte';
	import { accounts } from '$lib/stores/accounts.svelte';
	import { theme } from '$lib/stores/theme.svelte';
	import { twofactor } from '$lib/stores/twofactor.svelte';
	import { unread } from '$lib/stores/unread.svelte';
	import { initialsFor } from './initials';
	import { paletteFor } from './avatarPalette';
	import { portal } from '$lib/actions/portal';

	const themeIcons = { light: Sun, dark: Moon, auto: Monitor } as const;
	const ThemeIcon = $derived(themeIcons[theme.pref]);

	interface AccountEntry {
		id: string;
		name: string;
		email: string;
		org: string;
		domain: string;
		init: string;
		bg: string;
		fg: string;
	}

	let open = $state(false);
	let view = $state<'main' | 'switch'>('main');
	let switching = $state<AccountEntry | null>(null);
	let switchDone = $state(false);
	let removing = $state<AccountEntry | null>(null);
	let menuRef: HTMLDivElement | undefined = $state();

	function askRemove(a: AccountEntry) {
		open = false;
		removing = a;
	}

	function handleDocClick(e: MouseEvent) {
		if (menuRef && !menuRef.contains(e.target as Node)) open = false;
	}

	function handleKey(e: KeyboardEvent) {
		if (e.key === 'Escape') open = false;
	}

	const initials = $derived(initialsFor(auth.fullName, auth.email));
	const displayName = $derived(auth.fullName ?? auth.email ?? '');
	const displayEmail = $derived(auth.email ?? '');

	function domainFromEmail(em: string): string {
		const at = em.lastIndexOf('@');
		return at >= 0 ? em.slice(at + 1) : em;
	}

	const switcherAccounts = $derived<AccountEntry[]>(
		accounts.list.map((rec) => {
			const pal = paletteFor(rec.accountId);
			const name = auth.fullNameFor(rec.accountId) ?? rec.email;
			return {
				id: rec.accountId,
				name,
				email: rec.email,
				org: '',
				domain: domainFromEmail(rec.email),
				init: initialsFor(auth.fullNameFor(rec.accountId), rec.email),
				bg: pal.bg,
				fg: pal.fg
			};
		})
	);

	const activeAccount = $derived(
		switcherAccounts.find((a) => a.id === auth.accountId) ?? null
	);

	function unreadCountFor(accountId: string): number {
		return unread.countsFor(accountId)?.inbox ?? 0;
	}

	const hasBackgroundUnread = $derived(
		switcherAccounts.some((a) => a.id !== auth.accountId && unreadCountFor(a.id) > 0)
	);


	function currentSubpath(): string {
		const m = page.url.pathname.match(/^\/u\/\d+(\/.*)?$/);
		const rest = m?.[1] ?? '/mail/inbox';
		return rest && rest.length > 1 ? rest : '/mail/inbox';
	}

	let switchTimer: ReturnType<typeof setTimeout> | undefined;
	let finishTimer: ReturnType<typeof setTimeout> | undefined;

	function toggleMenu() {
		open = !open;
		if (open) {
			view = 'main';
			if (auth.accountId && twofactor.status === null && !twofactor.loading) {
				void twofactor.load();
			}
		}
	}

	function openSwitchView() {
		view = 'switch';
		void auth.loadSignedInProfiles();
	}

	function backToMain() {
		view = 'main';
	}

	async function doSwitch(a: AccountEntry) {
		if (activeAccount && a.id === activeAccount.id) {
			view = 'main';
			return;
		}
		const target = accounts.byId(a.id);
		if (!target) return;
		open = false;
		switchDone = false;
		switching = a;
		clearTimeout(switchTimer);
		clearTimeout(finishTimer);
		try {
			auth.activate(target.accountId);
			const dest = `/u/${target.slot}${currentSubpath()}`;
			await goto(dest);
			switchDone = true;
			finishTimer = setTimeout(() => {
				switching = null;
			}, 600);
		} catch {
			switching = null;
		}
	}

	async function signOut() {
		open = false;
		const id = auth.accountId;
		if (id) await auth.logoutAccount(id);
		const remaining = accounts.list[0];
		if (remaining) {
			auth.activate(remaining.accountId);
			await goto(`/u/${remaining.slot}/mail/inbox`);
		} else {
			await goto('/login');
		}
	}

	async function signOutAll(e: MouseEvent) {
		e.preventDefault();
		open = false;
		await auth.logoutAll();
		await goto('/login');
	}

	async function openSettings() {
		open = false;
		const slot = page.params.slot ?? '0';
		await goto(`/u/${slot}/settings/profile`);
	}

	async function openSettingsSection(id: string) {
		open = false;
		const slot = page.params.slot ?? '0';
		await goto(`/u/${slot}/settings/${id}`);
	}

	async function signInAnother(e: MouseEvent) {
		e.preventDefault();
		open = false;
		await goto('/login?addAccount=1');
	}

	async function createNewAccount(e: MouseEvent) {
		e.preventDefault();
		open = false;
		await goto('/register?addAccount=1');
	}
</script>

<svelte:document onmousedown={handleDocClick} onkeydown={handleKey} />

<div class="rail-acct" bind:this={menuRef}>
	<button class="acct-btn" onclick={toggleMenu} aria-expanded={open}>
		<span class="av-wrap">
			<Avatar {initials} src={auth.avatarUrl} fit="cover" size={28} bg="var(--pine-700)" fg="#EEF2EA" />
			{#if hasBackgroundUnread}<span class="acct-dot" aria-hidden="true"></span>{/if}
		</span>
		<span class="acct-tx">
			<span class="acct-nm" title={displayName}>{displayName}</span>
			<span class="acct-em" title={displayEmail}>{displayEmail}</span>
		</span>
		<span class="uchev"><NavMorph icon={open ? ChevronUp : ChevronDown} size={15} /></span>
	</button>
		{#if open && view === 'switch'}
			<div class="menu">
				<div class="swh">
					<button class="swh-bk" onclick={backToMain} title="Back"><ArrowLeft size={16} /></button>
					<span class="swh-t">Switch account</span>
				</div>
				{#each switcherAccounts as a (a.id)}
					{@const isCur = activeAccount?.id === a.id}
					<div class="acct-item">
						<button
							type="button"
							class="acct-row"
							class:cur={isCur}
							onclick={() => doSwitch(a)}
						>
							<Avatar
								initials={a.init}
								src={auth.avatarUrlFor(a.id)}
								fit="cover"
								size={38}
								bg={a.bg}
								fg={a.fg}
							/>
							<span class="ar-tx">
								<span class="ar-nm">{a.name}</span>
								<span class="ar-em">{a.email}</span>
								<span class="ar-org">{a.org ? `${a.org} · ${a.domain}` : a.domain}</span>
							</span>
							{#if isCur}
								<span class="ar-cur"><Check size={13} />Current</span>
							{:else}
								{#if unreadCountFor(a.id) > 0}
									<span class="ar-unread"
										>{unreadCountFor(a.id) > 99 ? '99+' : unreadCountFor(a.id)}</span
									>
								{/if}
								<span class="ar-go"><ArrowRight size={15} /></span>
							{/if}
						</button>
						{#if !isCur}
							<button
								type="button"
								class="ar-rm"
								title="Remove from this device"
								aria-label={`Remove ${a.email} from this device`}
								onclick={() => askRemove(a)}
							>
								<X size={14} strokeWidth={2} />
							</button>
						{/if}
					</div>
				{/each}
				<div class="msep"></div>
				<a class="mitem" href="/login" onclick={signInAnother}
					><LogIn size={17} />Sign in to another account</a
				>
				<a class="mitem" href="/register" onclick={createNewAccount}
					><UserPlus size={17} />Create a new account</a
				>
				{#if switcherAccounts.length > 0}
					<div class="msep"></div>
					<a class="mitem danger" href="/login" onclick={signOutAll}
						><LogOut size={17} />Sign out of all accounts</a
					>
				{/if}
				<div class="sw-note">
					Accounts stay signed in on this device. Manage sessions under Security.
				</div>
			</div>
		{:else if open}
			<div class="menu">
				<div class="mhead">
					<Avatar {initials} src={auth.avatarUrl} fit="cover" size={44} bg="var(--pine-700)" fg="#EEF2EA" />
					<div class="mh-tx">
						<div class="nm" title={displayName}>{displayName}</div>
						<div class="em" title={displayEmail}>{displayEmail}</div>
					</div>
				</div>
				<div class="msep"></div>
				<button class="mitem" onclick={openSwitchView}>
					<ArrowLeftRight size={17} />Switch account
					<span class="mi-chev"><ChevronRight size={15} /></span>
				</button>
				<div class="msep"></div>
				<button class="mitem" onclick={() => openSettingsSection('profile')}
					><User size={17} />Account &amp; profile</button
				>
				<button class="mitem" onclick={() => openSettingsSection('security')}
					><ShieldCheck size={17} />Security{#if twofactor.status}<span class="rt"
							>{twofactor.enabled ? '2FA on' : '2FA off'}</span
						>{/if}</button
				>
				<button class="mitem" onclick={() => openSettingsSection('addresses')}
					><AtSign size={17} />Aliases &amp; identities</button
				>
				<button class="mitem" onclick={openSettings}
					><Settings size={17} />Settings</button
				>
				<div class="msep"></div>
				<button class="mitem" onclick={() => theme.cycle()}>
					<ThemeIcon size={17} />Appearance<span class="rt">{theme.label}</span>
				</button>
				<div class="msep"></div>
				<button class="mitem danger" onclick={signOut}><LogOut size={17} />Sign out</button>
			</div>
	{/if}
</div>

{#if removing}
	<div use:portal>
		<RemoveAccountDialog
			accountId={removing.id}
			email={removing.email}
			name={removing.name}
			onClose={() => (removing = null)}
			onRemoved={() => {}}
		/>
	</div>
{/if}

{#if switching}
	<div class="sw-ovl" use:portal>
		<div class="sw-card">
			<img class="sw-logo" src={logoMark} alt="" width="40" height="40" />
			{#if switchDone}
				<span class="sw-ok"><Check size={16} /></span>
			{:else}
				<span class="sw-spin"></span>
			{/if}
			<div class="sw-t">{switchDone ? 'Signed in' : 'Switching account'}</div>
			<div class="sw-e">{switching.email}</div>
			<div class="sw-d">{switching.org} · {switching.domain}</div>
		</div>
	</div>
{/if}
