<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import { tick } from 'svelte';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Check from '@lucide/svelte/icons/check';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Search from '@lucide/svelte/icons/search';
	import Avatar from '$core/components/Avatar.svelte';
	import { initialsFor } from './initials';
	import type { SendIdentity } from './data';

	const FILTER_FROM = 7;
	const uid = $props.id();

	interface Props {
		options: SendIdentity[];
		current: SendIdentity;
		revoked: { email: string; name: string } | null;
		noSender: boolean;
		account: string;
		avatarUrl: string | null;
		open?: boolean;
		trigger?: HTMLButtonElement;
		onPick: (email: string) => void;
		onManage?: () => void;
	}

	let {
		options,
		current,
		revoked,
		noSender,
		account,
		avatarUrl,
		open = $bindable(false),
		trigger = $bindable(),
		onPick,
		onManage
	}: Props = $props();

	let row: HTMLDivElement | undefined = $state();
	let menu: HTMLDivElement | undefined = $state();
	let filter: HTMLInputElement | undefined = $state();
	let query = $state('');
	let typed = '';
	let typedAt = 0;

	const filterable = $derived(options.length >= FILTER_FROM);
	const selected = $derived(revoked ? null : current.email);
	const shown = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return options;
		return options.filter((o) => o.email.toLowerCase().includes(q) || o.name.toLowerCase().includes(q));
	});
	const face = $derived(
		revoked
			? { init: initialsFor(revoked.name, revoked.email), name: revoked.name, email: revoked.email }
			: { init: current.init, name: current.name, email: current.email }
	);

	function kindLabel(kind: SendIdentity['kind']): string {
		if (kind === 'Alias') return m.mail_compose_ident_shared();
		if (kind === 'Identity') return m.mail_compose_ident_identity();
		return m.mail_compose_ident_default();
	}

	function items(): HTMLButtonElement[] {
		return [...(menu?.querySelectorAll<HTMLButtonElement>('button.fm-item') ?? [])];
	}

	function focusItem(i: number): void {
		const list = items();
		if (list.length === 0) return;
		list[(i + list.length) % list.length].focus();
	}

	async function show(focusFirst: boolean): Promise<void> {
		query = '';
		open = true;
		await tick();
		if (filterable) filter?.focus();
		else if (focusFirst) {
			const list = items();
			const at = list.findIndex((b) => b.getAttribute('aria-checked') === 'true');
			focusItem(at < 0 ? 0 : at);
		}
	}

	function hide(refocus: boolean): void {
		open = false;
		query = '';
		if (refocus) trigger?.focus();
	}

	function pick(email: string): void {
		hide(true);
		onPick(email);
	}

	export function choose(): void {
		trigger?.focus();
		void show(true);
	}

	function onTriggerKey(e: KeyboardEvent): void {
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			void show(true);
		}
	}

	function typeAhead(key: string): void {
		const now = Date.now();
		typed = now - typedAt > 600 ? key : typed + key;
		typedAt = now;
		const list = items();
		const from = Math.max(0, list.indexOf(document.activeElement as HTMLButtonElement));
		const needle = typed.toLowerCase();
		for (let step = typed.length === 1 ? 1 : 0; step <= list.length; step++) {
			const b = list[(from + step) % list.length];
			const name = b.dataset.name ?? '';
			const email = b.dataset.email ?? '';
			if (name.startsWith(needle) || email.startsWith(needle)) {
				b.focus();
				return;
			}
		}
	}

	function onMenuKey(e: KeyboardEvent): void {
		const list = items();
		const at = list.indexOf(document.activeElement as HTMLButtonElement);
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			hide(true);
		} else if (e.key === 'Tab') {
			hide(false);
		} else if (e.target === filter) {
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				focusItem(0);
			} else if (e.key === 'Enter') {
				e.preventDefault();
				if (shown.length > 0) pick(shown[0].email);
			}
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			focusItem(at + 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			if (at <= 0 && filterable) filter?.focus();
			else focusItem(at - 1);
		} else if (e.key === 'Home') {
			e.preventDefault();
			focusItem(0);
		} else if (e.key === 'End') {
			e.preventDefault();
			focusItem(list.length - 1);
		} else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && /\S/.test(e.key)) {
			e.preventDefault();
			if (filterable) {
				query += e.key;
				filter?.focus();
			} else typeAhead(e.key.toLowerCase());
		}
	}

	function onDocDown(e: MouseEvent): void {
		if (open && row && !row.contains(e.target as Node)) hide(false);
	}
</script>

<svelte:document onmousedown={onDocDown} />

<div class="from-row" bind:this={row}>
	<span class="recip-label">{m.mail_compose_from()}</span>
	<button
		type="button"
		class="from-trigger"
		class:open
		class:revoked={!!revoked}
		bind:this={trigger}
		aria-haspopup="menu"
		aria-expanded={open}
		aria-describedby={revoked ? `${uid}-revoked` : undefined}
		onclick={() => (open ? hide(false) : void show(false))}
		onkeydown={onTriggerKey}
	>
		<Avatar
			initials={face.init}
			src={revoked || current.kind === 'Alias' ? null : avatarUrl}
			fit="cover"
			size={22}
			bg={revoked ? 'var(--paper-100)' : current.bg}
			fg={revoked ? 'var(--fg-faint)' : current.fg}
		/>
		<span class="ft-name">{face.name}</span>
		<span class="ft-email">&lt;{face.email}&gt;</span>
		<ChevronDown size={15} />
	</button>
	{#if open}
		<div
			class="from-menu"
			role="menu"
			tabindex="-1"
			aria-label={m.mail_compose_send_from_account({ account })}
			bind:this={menu}
			onkeydown={onMenuKey}
		>
			<div class="fm-h">{m.mail_compose_send_from_account({ account })}</div>
			{#if filterable}
				<label class="fm-filter">
					<Search size={14} />
					<input
						bind:this={filter}
						bind:value={query}
						type="text"
						autocomplete="off"
						spellcheck="false"
						placeholder={m.mail_compose_from_filter()}
						aria-label={m.mail_compose_from_filter()}
					/>
				</label>
			{/if}
			{#if revoked && !query}
				<div class="fm-item gone" role="menuitemradio" aria-checked="true" aria-disabled="true">
					<Avatar initials={face.init} size={30} bg="var(--paper-100)" fg="var(--fg-faint)" />
					<span class="fm-tx">
						<span class="fm-top">
							<b>{revoked.name}</b>
							<span class="fm-kind gone">{m.mail_compose_from_gone()}</span>
						</span>
						<span class="fm-em">{revoked.email}</span>
					</span>
				</div>
			{/if}
			{#each shown as id, i (id.email + '-' + i)}
				<button
					type="button"
					class="fm-item"
					class:on={id.email === selected}
					role="menuitemradio"
					aria-checked={id.email === selected}
					tabindex="-1"
					data-name={id.name.toLowerCase()}
					data-email={id.email.toLowerCase()}
					onclick={() => pick(id.email)}
				>
					<Avatar
						initials={id.init}
						src={id.kind === 'Alias' ? null : avatarUrl}
						fit="cover"
						size={30}
						bg={id.bg}
						fg={id.fg}
					/>
					<span class="fm-tx">
						<span class="fm-top">
							<b>{id.name}</b>
							<span class="fm-kind">{kindLabel(id.kind)}</span>
						</span>
						<span class="fm-em">{id.email}</span>
						{#if id.org}<span class="fm-org">{id.org}</span>{/if}
					</span>
					{#if id.email === selected}<Check size={17} />{/if}
				</button>
			{/each}
			{#if shown.length === 0}
				<div class="fm-none">{m.mail_compose_from_no_match()}</div>
			{/if}
			<div class="fm-foot">
				<span>{m.mail_compose_from_account_only()}</span>
				{#if onManage}
					<button
						type="button"
						class="fm-manage"
						onclick={() => {
							hide(false);
							onManage?.();
						}}
					>
						{m.mail_compose_manage_addresses()}
					</button>
				{/if}
			</div>
		</div>
	{/if}
</div>
{#if revoked}
	<div class="cwarn" role="alert">
		<CircleAlert size={14} />
		<span class="cwarn-t" id="{uid}-revoked">{m.mail_compose_from_revoked({ address: revoked.email })}</span>
		<button type="button" class="cwarn-act" onclick={choose}>{m.mail_compose_choose_address()}</button>
	</div>
{:else if noSender}
	<div class="cnote"><CircleAlert size={14} />{m.mail_compose_no_sender()}</div>
{/if}
