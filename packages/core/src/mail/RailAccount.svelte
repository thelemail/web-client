<script lang="ts">
	import { leavePending, settleForLeave } from '$core/stores/leaveGuard';
	import { m } from '$paraglide/messages.js';
	import { openCalendar as openCalendarProduct } from '$core/handoff';
	import { productLaunched } from '$core/products';
	import User from '@lucide/svelte/icons/user';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import AtSign from '@lucide/svelte/icons/at-sign';
	import Settings from '@lucide/svelte/icons/settings';
	import Sun from '@lucide/svelte/icons/sun';
	import Moon from '@lucide/svelte/icons/moon';
	import Monitor from '@lucide/svelte/icons/monitor';
	import LogOut from '@lucide/svelte/icons/log-out';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import Plus from '@lucide/svelte/icons/plus';
	import UsersRound from '@lucide/svelte/icons/users-round';
	import Check from '@lucide/svelte/icons/check';
	import { ChevronDown, ChevronUp } from 'lucide';
	import { tick } from 'svelte';
	import NavMorph from '$core/components/NavMorph.svelte';
	import Avatar from '$core/components/Avatar.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { auth } from '$core/stores/auth.svelte';
	import { accounts } from '$core/stores/accounts.svelte';
	import { accountReadiness } from '$core/stores/accountReadiness.svelte';
	import { theme } from '$core/stores/theme.svelte';
	import { twofactor } from '$core/stores/twofactor.svelte';
	import { unread } from '$core/stores/unread.svelte';
	import type { AccountReadiness } from './accountReadiness';
	import { initialsFor } from './initials';
	import { paletteFor } from './avatarPalette';

	const themeIcons = { light: Sun, dark: Moon, auto: Monitor } as const;
	const ThemeIcon = $derived(themeIcons[theme.pref]);

	interface AccountRow {
		id: string;
		slot: number;
		name: string | null;
		email: string;
		init: string;
		bg: string;
		fg: string;
		current: boolean;
		state: AccountReadiness;
		unread: number;
	}

	const uid = $props.id();
	const menuId = `acct-menu-${uid}`;

	let open = $state(false);
	let rootRef: HTMLDivElement | undefined = $state();
	let triggerRef: HTMLButtonElement | undefined = $state();
	let menuRef: HTMLDivElement | undefined = $state();

	const initials = $derived(initialsFor(auth.fullName, auth.email));
	const displayName = $derived(auth.fullName ?? auth.email ?? '');
	const displayEmail = $derived(auth.email ?? '');

	function unreadCountFor(accountId: string): number {
		return unread.countsFor(accountId)?.inbox ?? 0;
	}

	const rows = $derived.by<AccountRow[]>(() => {
		const list = accounts.list.map((rec) => {
			const pal = paletteFor(rec.accountId);
			const full = auth.fullNameFor(rec.accountId)?.trim() || null;
			const current = rec.accountId === auth.accountId;
			return {
				id: rec.accountId,
				slot: rec.slot,
				name: full && full !== rec.email ? full : null,
				email: rec.email,
				init: initialsFor(full, rec.email),
				bg: pal.bg,
				fg: pal.fg,
				current,
				state: current ? 'ready' : accountReadiness.of(rec.accountId),
				unread: unreadCountFor(rec.accountId)
			} satisfies AccountRow;
		});
		return [...list.filter((r) => r.current), ...list.filter((r) => !r.current)];
	});

	const hasBackgroundUnread = $derived(
		rows.some((r) => !r.current && r.state === 'ready' && r.unread > 0)
	);

	function stateLabel(state: AccountReadiness): string {
		switch (state) {
			case 'syncing':
				return m.mail_acct_state_syncing();
			case 'locked':
				return m.mail_acct_state_locked();
			case 'expired':
				return m.mail_acct_state_expired();
			case 'unavailable':
				return m.mail_acct_state_unavailable();
			default:
				return m.mail_acct_state_ready();
		}
	}

	function actionLabel(state: AccountReadiness): string | null {
		switch (state) {
			case 'locked':
				return m.mail_acct_action_unlock();
			case 'expired':
				return m.mail_acct_action_sign_in();
			case 'unavailable':
				return m.mail_acct_action_retry();
			default:
				return null;
		}
	}

	function rowLabel(r: AccountRow): string {
		const state = r.current
			? m.mail_acct_state_current()
			: r.state === 'ready' && r.unread > 0
				? m.mail_acct_unread({ count: String(r.unread) })
				: stateLabel(r.state);
		const action = r.current ? null : actionLabel(r.state);
		const address = r.email;
		if (r.name) {
			const name = r.name;
			return action
				? m.mail_acct_row_action_label({ name, address, state, action })
				: m.mail_acct_row_label({ name, address, state });
		}
		return action
			? m.mail_acct_row_action_label_bare({ address, state, action })
			: m.mail_acct_row_label_bare({ address, state });
	}

	function addressParts(address: string): string[] {
		const at = address.lastIndexOf('@');
		return at > 0 ? [address.slice(0, at), address.slice(at)] : [address];
	}

	function items(): HTMLElement[] {
		return menuRef ? [...menuRef.querySelectorAll<HTMLElement>('[role="menuitem"]')] : [];
	}

	function focusItem(index: number) {
		const list = items();
		if (list.length === 0) return;
		list[(index + list.length) % list.length].focus();
	}

	async function openMenu(focus: 'first' | 'last' | 'menu') {
		open = true;
		if (auth.accountId) twofactor.ensure(auth.accountId);
		if (accounts.list.some((r) => auth.fullNameFor(r.accountId) === null)) {
			void auth.loadSignedInProfiles();
		}
		void accountReadiness.probe(accounts.list.map((r) => r.accountId).filter((id) => id !== auth.accountId));
		await tick();
		if (focus === 'menu') menuRef?.focus();
		else focusItem(focus === 'first' ? 0 : -1);
	}

	function closeMenu(restoreFocus: boolean) {
		if (!open) return;
		open = false;
		if (restoreFocus) triggerRef?.focus();
	}

	function toggleMenu() {
		if (open) closeMenu(true);
		else void openMenu('menu');
	}

	function onTriggerKey(e: KeyboardEvent) {
		if (open) return;
		if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			void openMenu('first');
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			void openMenu('last');
		}
	}

	function onMenuKey(e: KeyboardEvent) {
		const list = items();
		const at = list.indexOf(document.activeElement as HTMLElement);
		switch (e.key) {
			case 'ArrowDown':
				e.preventDefault();
				focusItem(at + 1);
				break;
			case 'ArrowUp':
				e.preventDefault();
				focusItem(at < 0 ? -1 : at - 1);
				break;
			case 'Home':
				e.preventDefault();
				focusItem(0);
				break;
			case 'End':
				e.preventDefault();
				focusItem(-1);
				break;
			case 'Escape':
				e.preventDefault();
				e.stopPropagation();
				closeMenu(true);
				break;
			case 'Tab':
				closeMenu(false);
				break;
		}
	}

	function handleDocClick(e: MouseEvent) {
		if (open && rootRef && !rootRef.contains(e.target as Node)) closeMenu(false);
	}

	async function releaseWork(): Promise<boolean> {
		return !leavePending() || (await settleForLeave());
	}

	async function choose(r: AccountRow) {
		if (r.current) {
			closeMenu(true);
			return;
		}
		if (r.state === 'unavailable') {
			void accountReadiness.probe([r.id], true);
			return;
		}
		closeMenu(false);
		if (!(await releaseWork())) return;
		if (r.state === 'locked' || r.state === 'expired') {
			const back = encodeURIComponent(`/u/${r.slot}/mail/inbox`);
			await goto(`/login?slot=${r.slot}&redirect=${back}`);
			return;
		}
		const target = accounts.byId(r.id);
		if (!target) return;
		auth.activate(target.accountId);
		await goto(`/u/${target.slot}/mail/inbox`);
	}

	async function signOut() {
		closeMenu(false);
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

	async function signOutAll() {
		closeMenu(false);
		await auth.logoutAll();
		await goto('/login');
	}

	async function openCalendar() {
		closeMenu(false);
		const slot = Number(page.params.slot ?? '0');
		if (!auth.accountId) return;
		await openCalendarProduct(auth.accountId, slot);
	}

	async function openSettingsSection(id: string) {
		closeMenu(false);
		const slot = page.params.slot ?? '0';
		await goto(`/u/${slot}/settings/${id}`);
	}

	async function manageAccounts() {
		closeMenu(false);
		await goto('/');
	}

	async function addAccount() {
		closeMenu(false);
		await goto('/login?addAccount=1');
	}
</script>

<svelte:document onmousedown={handleDocClick} />

<div class="rail-acct" bind:this={rootRef}>
	<button
		bind:this={triggerRef}
		class="acct-btn"
		onclick={toggleMenu}
		onkeydown={onTriggerKey}
		aria-haspopup="menu"
		aria-expanded={open}
		aria-controls={open ? menuId : undefined}
	>
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
	{#if open}
		<div
			class="menu acct-menu"
			id={menuId}
			role="menu"
			tabindex="-1"
			aria-label={m.mail_acct_accounts()}
			bind:this={menuRef}
			onkeydown={onMenuKey}
		>
			<div class="acct-h">{m.mail_acct_accounts()}</div>
			<div class="acct-list" role="group" aria-label={m.mail_acct_accounts()}>
				{#each rows as r (r.id)}
					{@const action = r.current ? null : actionLabel(r.state)}
					<button
						type="button"
						role="menuitem"
						tabindex="-1"
						class="acct-row"
						class:cur={r.current}
						data-state={r.state}
						aria-current={r.current ? 'true' : undefined}
						aria-label={rowLabel(r)}
						onclick={() => choose(r)}
					>
						<Avatar
							initials={r.init}
							src={auth.avatarUrlFor(r.id)}
							fit="cover"
							size={34}
							bg={r.bg}
							fg={r.fg}
						/>
						<span class="ar-tx">
							{#if r.name}<span class="ar-nm">{r.name}</span>{/if}
							<span class="ar-em" class:solo={!r.name}
								>{#each addressParts(r.email) as part, i (i)}{#if i > 0}<wbr />{/if}<span class="ar-ep">{part}</span>{/each}</span
							>
							{#if !r.current && r.state !== 'ready'}
								<span class="ar-st" aria-hidden="true">{stateLabel(r.state)}</span>
							{/if}
						</span>
						<span class="ar-side" aria-hidden="true">
							{#if r.current}
								<span class="ar-cur"><Check size={13} />{m.mail_acct_current()}</span>
							{:else if action}
								<span class="ar-act">{action}</span>
							{:else if r.state === 'ready'}
								{#if r.unread > 0}
									<span class="ar-unread"
										>{m.mail_acct_unread({ count: r.unread > 99 ? '99+' : String(r.unread) })}</span
									>
								{/if}
								<span class="ar-go"><ChevronRight size={15} /></span>
							{/if}
						</span>
					</button>
				{/each}
			</div>
			<div class="acct-acts">
				<button type="button" role="menuitem" tabindex="-1" class="mitem" onclick={addAccount}
					><Plus size={17} />{m.mail_acct_add()}</button
				>
				{#if rows.length > 1}
					<button type="button" role="menuitem" tabindex="-1" class="mitem" onclick={manageAccounts}
						><UsersRound size={17} />{m.mail_acct_manage()}</button
					>
				{/if}
			</div>
			<div class="msep" role="separator"></div>
			{#if productLaunched('calendar')}
				<button type="button" role="menuitem" tabindex="-1" class="mitem" onclick={openCalendar}>
					<CalendarDays size={17} />{m.mail_acct_go_calendar()}
				</button>
				<div class="msep" role="separator"></div>
			{/if}
			<button type="button" role="menuitem" tabindex="-1" class="mitem" onclick={() => openSettingsSection('profile')}
				><User size={17} />{m.mail_acct_profile()}</button
			>
			<button type="button" role="menuitem" tabindex="-1" class="mitem" onclick={() => openSettingsSection('security')}
				><ShieldCheck size={17} />{m.mail_acct_security()}{#if twofactor.status}<span class="rt"
						>{twofactor.enabled ? m.mail_acct_2fa_on() : m.mail_acct_2fa_off()}</span
					>{/if}</button
			>
			<button type="button" role="menuitem" tabindex="-1" class="mitem" onclick={() => openSettingsSection('addresses')}
				><AtSign size={17} />{m.mail_acct_aliases()}</button
			>
			<button type="button" role="menuitem" tabindex="-1" class="mitem" onclick={() => openSettingsSection('profile')}
				><Settings size={17} />{m.mail_acct_settings()}</button
			>
			<div class="msep" role="separator"></div>
			<button type="button" role="menuitem" tabindex="-1" class="mitem" onclick={() => theme.cycle()}>
				<ThemeIcon size={17} />{m.mail_acct_appearance()}<span class="rt">{theme.label}</span>
			</button>
			<div class="msep" role="separator"></div>
			<button type="button" role="menuitem" tabindex="-1" class="mitem danger" onclick={signOut}
				><LogOut size={17} />{m.mail_acct_sign_out()}</button
			>
			{#if rows.length > 1}
				<button type="button" role="menuitem" tabindex="-1" class="mitem danger" onclick={signOutAll}
					><LogOut size={17} />{m.mail_acct_sign_out_all()}</button
				>
			{/if}
		</div>
	{/if}
</div>
