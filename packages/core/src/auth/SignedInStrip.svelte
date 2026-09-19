<script lang="ts">
	import { page } from '$app/state';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Avatar from '$core/components/Avatar.svelte';
	import { initialsFor } from '$core/mail/initials';
	import { auth } from '$core/stores/auth.svelte';
	import { accounts } from '$core/stores/accounts.svelte';
	import Rich from '$core/i18n/Rich.svelte';
	import { m } from '$paraglide/messages.js';

	const known = $derived(accounts.list);
	const single = $derived(
		known.length === 1
			? [...known].sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0]
			: null
	);
	const name = $derived(single ? (auth.fullNameFor(single.accountId)?.trim() ?? '') : '');
	const show = $derived(known.length > 0 && page.url.pathname !== '/');
</script>

{#snippet strong(t: string)}<strong>{t}</strong>{/snippet}

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
			<span class="si-tx" title={single.email}
				><Rich text={m.auth_signed_in_as({ email: single.email })} tags={{ b: strong }} /></span
			>
			<a class="si-go" href="/">{m.auth_signed_in_open_mailbox()}<ArrowRight size={15} strokeWidth={1.75} /></a>
		{:else}
			<span class="si-tx">{m.auth_signed_in_count({ count: known.length })}</span>
			<a class="si-go" href="/">{m.auth_signed_in_choose_account()}<ArrowRight size={15} strokeWidth={1.75} /></a>
		{/if}
	</div>
{/if}
