<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import { page } from '$app/state';
	import Menu from '@lucide/svelte/icons/menu';
	import CircleHelp from '@lucide/svelte/icons/circle-help';
	import Settings from '@lucide/svelte/icons/settings';
	import * as Tooltip from '$core/components/ui/tooltip';
	import { platform } from '$platform';
	import { mailNav } from '$core/stores/nav.svelte';
	import { auth } from '$core/stores/auth.svelte';
	import { accounts } from '$core/stores/accounts.svelte';
	import ListSearch from './ListSearch.svelte';

	const HELP_URL = 'https://thelemail.com/documentation';

	const slot = $derived(page.params.slot ?? '0');
	const view = $derived(page.url.pathname.match(/\/mail\/(drafts|scheduled)(\/|$)/)?.[1] ?? null);
	const placeholder = $derived(
		view === 'drafts'
			? m.mail_search_drafts()
			: view === 'scheduled'
				? m.mail_search_scheduled()
				: accounts.list.length > 1 && auth.email
					? m.mail_search_in_account({ address: auth.email })
					: m.mail_search_placeholder()
	);
</script>

<header class="mail-top">
	<button
		type="button"
		class="lh-nav"
		aria-label={m.mail_menu()}
		aria-expanded={mailNav.open}
		onclick={(e) => mailNav.toggle(e.currentTarget)}
	>
		<Menu size={18} />
	</button>
	<ListSearch {placeholder} operators={view === null} />
	<span class="mt-rule" aria-hidden="true"></span>
	<Tooltip.Provider delayDuration={150} disableHoverableContent>
		<Tooltip.Root>
			<Tooltip.Trigger class="mt-btn" aria-label={m.mail_top_help()} onclick={() => platform.openLink(HELP_URL)}>
				<CircleHelp size={18} />
			</Tooltip.Trigger>
			<Tooltip.Content side="bottom" sideOffset={6}>{m.mail_top_help()}</Tooltip.Content>
		</Tooltip.Root>
		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<a {...props} class="mt-btn" href={`/u/${slot}/settings`} aria-label={m.mail_acct_settings()}>
						<Settings size={18} />
					</a>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content side="bottom" sideOffset={6}>{m.mail_acct_settings()}</Tooltip.Content>
		</Tooltip.Root>
	</Tooltip.Provider>
</header>
