<script lang="ts">
	import { delayed } from '$core/async/delayed.svelte';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import Icon from '$core/components/Icon.svelte';
	import {
		faArrowRightToBracket,
		faChevronRight,
		faUserPlus,
		faXmark
	} from '@fortawesome/pro-regular-svg-icons';
	import Avatar from '$core/components/Avatar.svelte';
	import RemoveAccountDialog from '$core/mail/RemoveAccountDialog.svelte';
	import { initialsFor } from '$core/mail/initials';
	import { keystore } from '$core/keystore/keystore-client';
	import { auth } from '$core/stores/auth.svelte';
	import { accounts } from '$core/stores/accounts.svelte';
	import { page } from '$app/state';
	import { resolveReturnTo } from '$core/auth/return-to';
	import { m } from '$paraglide/messages.js';

	const returnTo = $derived(page.url.searchParams.get('redirect'));
	const moreQuery = $derived(
		returnTo ? `&redirect=${encodeURIComponent(returnTo)}` : ''
	);

	let navigating = $state<string | null>(null);
	let removing = $state<{ id: string; email: string; name: string | null } | null>(null);

	onMount(async () => {
		const status = await keystore.status();
		auth.syncFromKeystoreStatus(status);
	});

	const rows = $derived(
		[...accounts.list]
			.sort((a, b) => b.lastActiveAt - a.lastActiveAt)
			.map((rec) => {
				const name = auth.fullNameFor(rec.accountId)?.trim() ?? '';
				return {
					id: rec.accountId,
					slot: rec.slot,
					email: rec.email,
					name: name && name !== rec.email ? name : null,
					initials: initialsFor(name || null, rec.email),
					avatarUrl: auth.avatarUrlFor(rec.accountId),
					unlocked: auth.vaultUnlockedFor(rec.accountId)
				};
			})
	);

	async function afterRemove() {
		const remaining = accounts.list;
		if (remaining.length === 0) {
			await goto('/login');
		} else if (remaining.length === 1) {
			await goto(resolveReturnTo(returnTo, remaining[0].slot));
		}
	}

	const opening = delayed(() => navigating !== null, { key: () => navigating });

	async function open(slot: number, id: string) {
		if (navigating) return;
		navigating = id;
		try {
			await goto(resolveReturnTo(returnTo, slot));
		} finally {
			navigating = null;
		}
	}
</script>

<svelte:head>
	<title>{m.auth_picker_page_title()}</title>
</svelte:head>

<div class="card-surface">
	<div class="card-head">
		<p class="eyebrow">{m.auth_picker_eyebrow()}</p>
		<h1>{m.auth_picker_title()}</h1>
	</div>
	<div class="acctpick">
		{#each rows as row (row.id)}
			<div class="apick-item" class:apick-item-locked={!row.unlocked}>
				<button
					type="button"
					class="apick-row"
					disabled={navigating !== null}
					aria-busy={navigating === row.id || undefined}
					onclick={() => open(row.slot, row.id)}
				>
					<Avatar
						initials={row.initials}
						src={row.avatarUrl}
						fit="cover"
						size={38}
						bg={row.unlocked ? 'var(--primary)' : 'var(--pine-100)'}
						fg={row.unlocked ? 'var(--primary-fg)' : 'var(--pine-700)'}
					/>
					<span class="ap-tx">
						{#if row.name}
							<span class="ap-nm" title={row.name}>{row.name}</span>
						{/if}
						<span class="ap-em" title={row.email}>{row.email}</span>
						<span class="ap-state" class:ap-locked={!row.unlocked}>
							{#if navigating === row.id && opening.visible}
								{m.account_transition_opening_plain()}…
							{:else}
								{row.unlocked ? m.auth_picker_state_signed_in() : m.auth_picker_state_locked()}
							{/if}
						</span>
					</span>
					<span class="ap-go"><Icon icon={faChevronRight} size={16} /></span>
				</button>
				<button
					type="button"
					class="apick-rm"
					title={m.auth_picker_remove_title()}
					aria-label={m.auth_picker_remove_label({ email: row.email })}
					disabled={navigating !== null}
					onclick={() => (removing = { id: row.id, email: row.email, name: row.name })}
				>
					<Icon icon={faXmark} size={15} />
				</button>
			</div>
		{/each}
	</div>
	<div class="apick-more">
		<a class="apick-link" href={`/login?addAccount=1${moreQuery}`}>
			<Icon icon={faArrowRightToBracket} size={17} />{m.auth_picker_sign_in_another()}
		</a>
		<a class="apick-link" href={`/register?addAccount=1${moreQuery}`}>
			<Icon icon={faUserPlus} size={17} />{m.auth_picker_create_new()}
		</a>
	</div>
	<p class="apick-note">{m.auth_picker_note()}</p>
</div>

{#if removing}
	<RemoveAccountDialog
		accountId={removing.id}
		email={removing.email}
		name={removing.name}
		onClose={() => (removing = null)}
		onRemoved={() => void afterRemove()}
	/>
{/if}
