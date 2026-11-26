<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import { page } from '$app/state';
	import Icon from '$core/components/Icon.svelte';
	import { faBars, faCircleQuestion, faGear } from '@fortawesome/pro-regular-svg-icons';
	import { Button } from '$core/components/ui/button';
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
	<Button
		variant="ghost"
		size="icon-sm"
		class="lh-nav"
		aria-label={m.mail_menu()}
		aria-expanded={mailNav.open}
		onclick={(e) => mailNav.toggle(e.currentTarget)}
	>
		<Icon icon={faBars} size={18} />
	</Button>
	<ListSearch {placeholder} operators={view === null} />
	<span class="mt-rule" aria-hidden="true"></span>
	<Button
		variant="ghost"
		size="icon-sm"
		tooltip={m.mail_top_help()}
		tooltipSide="bottom"
		onclick={() => platform.openLink(HELP_URL)}
	>
		<Icon icon={faCircleQuestion} size={18} />
	</Button>
	<Button variant="ghost" size="icon-sm" href={`/u/${slot}/settings`} tooltip={m.mail_acct_settings()} tooltipSide="bottom">
		<Icon icon={faGear} size={18} />
	</Button>
</header>
