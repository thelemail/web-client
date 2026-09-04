<script lang="ts">
	import { page } from '$app/state';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Avatar from '$lib/components/Avatar.svelte';
	import { initialsFor } from '$lib/mail/initials';
	import { auth } from '$lib/stores/auth.svelte';
	import { accounts } from '$lib/stores/accounts.svelte';

	const known = $derived(accounts.list);
	const single = $derived(
		known.length === 1
			? [...known].sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0]
			: null
	);
	const name = $derived(single ? (auth.fullNameFor(single.accountId)?.trim() ?? '') : '');
	const show = $derived(known.length > 0 && page.url.pathname !== '/');
</script>

{#if show}
	<div class="sistrip">
		{#if single}
			<Avatar
				initials={initialsFor(name || null, single.email)}
				src={auth.avatarUrlFor(single.accountId)}
				fit="cover"
				size={32}
				bg="var(--pine-700)"
				fg="#EEF2EA"
			/>
			<span class="si-tx" title={single.email}>Signed in as <strong>{single.email}</strong></span>
			<a class="si-go" href="/">Open mailbox<ArrowRight size={15} strokeWidth={1.75} /></a>
		{:else}
			<span class="si-tx">{known.length} accounts signed in on this device</span>
			<a class="si-go" href="/">Choose account<ArrowRight size={15} strokeWidth={1.75} /></a>
		{/if}
	</div>
{/if}
