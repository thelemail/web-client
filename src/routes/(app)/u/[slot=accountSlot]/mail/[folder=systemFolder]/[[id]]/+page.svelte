<script lang="ts">
	import { page } from '$app/state';
	import MailView from '$lib/mail/MailView.svelte';
	import DraftsView from '$lib/mail/DraftsView.svelte';
	import ScheduledView from '$lib/mail/ScheduledView.svelte';
	import { parseQuery } from '$lib/mail/url';

	const folder = $derived(page.params.folder);
	const query = $derived(parseQuery(folder, page.url.searchParams));
	const basePath = $derived(`/u/${page.params.slot}/mail/${folder}`);
	const messageId = $derived(page.params.id ?? null);
</script>

{#if folder === 'drafts'}
	<DraftsView />
{:else if folder === 'scheduled'}
	<ScheduledView />
{:else}
	<MailView {basePath} {query} {messageId} />
{/if}
