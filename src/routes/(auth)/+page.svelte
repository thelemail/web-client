<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import LogIn from '@lucide/svelte/icons/log-in';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import Avatar from '$lib/mail/Avatar.svelte';
	import { initialsFor } from '$lib/mail/initials';
	import { keystore } from '$lib/keystore/keystore-client';
	import { auth } from '$lib/stores/auth.svelte';
	import { accounts } from '$lib/stores/accounts.svelte';

	let navigating = $state<string | null>(null);

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

	async function open(slot: number, id: string) {
		if (navigating) return;
		navigating = id;
		try {
			await goto(`/u/${slot}/mail/inbox`);
		} finally {
			navigating = null;
		}
	}
</script>

<svelte:head>
	<title>Thelemail — Choose an account</title>
</svelte:head>

<div class="card-surface screen-fade">
	<div class="card-head">
		<p class="eyebrow">Signed in on this device</p>
		<h1>Choose an account</h1>
	</div>
	<div class="acctpick">
		{#each rows as row (row.id)}
			<button
				type="button"
				class="apick-row"
				disabled={navigating !== null}
				onclick={() => open(row.slot, row.id)}
			>
				<Avatar
					initials={row.initials}
					src={row.avatarUrl}
					fit="cover"
					size={38}
					bg={row.unlocked ? 'var(--pine-700)' : 'var(--pine-100)'}
					fg={row.unlocked ? '#EEF2EA' : 'var(--pine-700)'}
				/>
				<span class="ap-tx">
					{#if row.name}
						<span class="ap-nm" title={row.name}>{row.name}</span>
					{/if}
					<span class="ap-em" title={row.email}>{row.email}</span>
					<span class="ap-state" class:ap-locked={!row.unlocked}>
						{row.unlocked ? 'Signed in' : 'Locked'}
					</span>
				</span>
				<span class="ap-go"><ChevronRight size={16} strokeWidth={1.75} /></span>
			</button>
		{/each}
	</div>
	<div class="apick-more">
		<a class="apick-link" href="/login?addAccount=1">
			<LogIn size={17} strokeWidth={1.75} />Sign in to another account
		</a>
		<a class="apick-link" href="/register?addAccount=1">
			<UserPlus size={17} strokeWidth={1.75} />Create a new account
		</a>
	</div>
	<p class="apick-note">Locked accounts ask for your password before the mailbox opens.</p>
</div>
