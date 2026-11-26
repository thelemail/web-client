<script lang="ts">
	import { accountTransition } from '$core/stores/accountTransition.svelte';
	import { leavePending, settleForLeave } from '$core/stores/leaveGuard';
	import { m } from '$paraglide/messages.js';
	import { openCalendar as openCalendarProduct } from '$core/handoff';
	import { productLaunched } from '$core/products';
	import Icon from '$core/components/Icon.svelte';
	import {
		faArrowRightFromBracket,
		faAt,
		faCalendarDays,
		faCheck,
		faChevronDown,
		faChevronRight,
		faDisplay,
		faGear,
		faMoon,
		faPlus,
		faShieldCheck,
		faSun,
		faUser,
		faUserGroup
	} from '@fortawesome/pro-regular-svg-icons';
	import Avatar from '$core/components/Avatar.svelte';
	import * as DropdownMenu from '$core/components/ui/dropdown-menu';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { signInMovedToAuth, signInMovedToAuthKnown } from '$core/custody/unlock';
	import { openAuthTab } from '$core/producthandoff/tab';
	import { auth } from '$core/stores/auth.svelte';
	import { accounts } from '$core/stores/accounts.svelte';
	import { accountReadiness } from '$core/stores/accountReadiness.svelte';
	import { theme } from '$core/stores/theme.svelte';
	import { twofactor } from '$core/stores/twofactor.svelte';
	import { unread } from '$core/stores/unread.svelte';
	import type { AccountReadiness } from './accountReadiness';
	import { initialsFor } from './initials';
	import { paletteFor } from './avatarPalette';

	const themeIcons = { light: faSun, dark: faMoon, auto: faDisplay } as const;
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

	let open = $state(false);

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

	function prepare() {
		void signInMovedToAuth();
		if (auth.accountId) twofactor.ensure(auth.accountId);
		if (accounts.list.some((r) => auth.fullNameFor(r.accountId) === null)) {
			void auth.loadSignedInProfiles();
		}
		void accountReadiness.probe(accounts.list.map((r) => r.accountId).filter((id) => id !== auth.accountId));
	}

	async function releaseWork(): Promise<boolean> {
		return !leavePending() || (await settleForLeave());
	}

	async function choose(e: Event, r: AccountRow) {
		if (r.current) return;
		if (r.state === 'unavailable') {
			e.preventDefault();
			void accountReadiness.probe([r.id], true);
			return;
		}
		const locked = r.state === 'locked' || r.state === 'expired';
		const inbox = `/u/${r.slot}/mail/inbox`;
		if (locked && !leavePending() && auth.vaultUnlocked && (auth.mailOnlyFor(r.id) || signInMovedToAuthKnown())) {
			openAuthTab(r.id, inbox);
		}
		if (!(await releaseWork())) return;
		if (locked) {
			await goto(`/login?slot=${r.slot}&redirect=${encodeURIComponent(inbox)}`);
			return;
		}
		const target = accounts.byId(r.id);
		if (!target) return;
		await accountTransition.run('switch', target.email ?? null, async () => {
			auth.activate(target.accountId);
			await goto(`/u/${target.slot}/mail/inbox`);
		});
	}

	async function signOut() {
		await accountTransition.run('signout', null, async () => {
			const id = auth.accountId;
			if (id) await auth.logoutAccount(id);
			const remaining = accounts.list[0];
			if (remaining) {
				auth.activate(remaining.accountId);
				await goto(`/u/${remaining.slot}/mail/inbox`);
			} else {
				await goto('/login');
			}
		});
	}

	async function signOutAll() {
		await accountTransition.run('signout', null, async () => {
			await auth.logoutAll();
			await goto('/login');
		});
	}

	async function openCalendar() {
		const slot = Number(page.params.slot ?? '0');
		if (!auth.accountId) return;
		await openCalendarProduct(auth.accountId, slot);
	}

	async function openSettingsSection(id: string) {
		const slot = page.params.slot ?? '0';
		await goto(`/u/${slot}/settings/${id}`);
	}

	async function manageAccounts() {
		await goto('/');
	}

	async function addAccount() {
		if (auth.vaultUnlocked && signInMovedToAuthKnown()) openAuthTab(null, '/');
		await goto('/login?addAccount=1');
	}
</script>

<div class="rail-acct">
	<DropdownMenu.Root
		bind:open
		onOpenChange={(next) => {
			if (next) prepare();
		}}
	>
		<DropdownMenu.Trigger>
			{#snippet child({ props })}
				<button {...props} type="button" class="acct-btn">
					<span class="av-wrap">
						<Avatar {initials} src={auth.avatarUrl} fit="cover" size={28} bg="var(--pine-100)" fg="var(--pine-700)" />
						{#if hasBackgroundUnread}<span class="acct-dot" aria-hidden="true"></span>{/if}
					</span>
					<span class="acct-tx">
						<span class="acct-nm" title={displayName}>{displayName}</span>
						<span class="acct-em" title={displayEmail}>{displayEmail}</span>
					</span>
					<span class="uchev" class:open><Icon icon={faChevronDown} size={15} /></span>
				</button>
			{/snippet}
		</DropdownMenu.Trigger>
		<DropdownMenu.Content
			class="acct-menu"
			side="top"
			align="start"
			sideOffset={8}
			portalProps={{ to: '.mail-app' }}
			aria-label={m.mail_acct_accounts()}
		>
			<DropdownMenu.Group class="acct-list" aria-label={m.mail_acct_accounts()}>
				<DropdownMenu.GroupHeading>{m.mail_acct_accounts()}</DropdownMenu.GroupHeading>
				{#each rows as r (r.id)}
					{@const action = r.current ? null : actionLabel(r.state)}
					<DropdownMenu.Item
						class={'acct-row' + (r.current ? ' cur' : '')}
						data-account-state={r.state}
						aria-current={r.current ? 'true' : undefined}
						aria-label={rowLabel(r)}
						onSelect={(e) => void choose(e, r)}
					>
						<Avatar initials={r.init} src={auth.avatarUrlFor(r.id)} fit="cover" size={34} bg={r.bg} fg={r.fg} />
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
								<span class="ar-cur"><Icon icon={faCheck} size={13} />{m.mail_acct_current()}</span>
							{:else if action}
								<span class="ar-act">{action}</span>
							{:else if r.state === 'ready'}
								{#if r.unread > 0}
									<span class="ar-unread">{m.mail_acct_unread({ count: r.unread > 99 ? '99+' : String(r.unread) })}</span>
								{/if}
								<span class="ar-go"><Icon icon={faChevronRight} size={15} /></span>
							{/if}
						</span>
					</DropdownMenu.Item>
				{/each}
			</DropdownMenu.Group>
			<DropdownMenu.Item onSelect={addAccount}><Icon icon={faPlus} size={16} />{m.mail_acct_add()}</DropdownMenu.Item>
			{#if rows.length > 1}
				<DropdownMenu.Item onSelect={manageAccounts}><Icon icon={faUserGroup} size={16} />{m.mail_acct_manage()}</DropdownMenu.Item>
			{/if}
			<DropdownMenu.Separator />
			{#if productLaunched('calendar')}
				<DropdownMenu.Item onSelect={openCalendar}><Icon icon={faCalendarDays} size={16} />{m.mail_acct_go_calendar()}</DropdownMenu.Item>
				<DropdownMenu.Separator />
			{/if}
			<DropdownMenu.Item onSelect={() => openSettingsSection('profile')}><Icon icon={faUser} size={16} />{m.mail_acct_profile()}</DropdownMenu.Item>
			<DropdownMenu.Item onSelect={() => openSettingsSection('security')}>
				<Icon icon={faShieldCheck} size={16} />{m.mail_acct_security()}
				{#if twofactor.status}<span class="menu-meta">{twofactor.enabled ? m.mail_acct_2fa_on() : m.mail_acct_2fa_off()}</span>{/if}
			</DropdownMenu.Item>
			<DropdownMenu.Item onSelect={() => openSettingsSection('addresses')}><Icon icon={faAt} size={16} />{m.mail_acct_aliases()}</DropdownMenu.Item>
			<DropdownMenu.Item onSelect={() => openSettingsSection('profile')}><Icon icon={faGear} size={16} />{m.mail_acct_settings()}</DropdownMenu.Item>
			<DropdownMenu.Separator />
			<DropdownMenu.Item
				onSelect={(e) => {
					e.preventDefault();
					theme.cycle();
				}}
			>
				<Icon icon={ThemeIcon} size={16} />{m.mail_acct_appearance()}<span class="menu-meta">{theme.label}</span>
			</DropdownMenu.Item>
			<DropdownMenu.Separator />
			<DropdownMenu.Item variant="danger" onSelect={signOut}>
				<Icon icon={faArrowRightFromBracket} size={16} />{m.mail_acct_sign_out()}
			</DropdownMenu.Item>
			{#if rows.length > 1}
				<DropdownMenu.Item variant="danger" onSelect={signOutAll}>
					<Icon icon={faArrowRightFromBracket} size={16} />{m.mail_acct_sign_out_all()}
				</DropdownMenu.Item>
			{/if}
		</DropdownMenu.Content>
	</DropdownMenu.Root>
</div>
