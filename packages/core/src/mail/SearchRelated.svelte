<script lang="ts">
	import type { Snippet } from 'svelte';
	import { m as msg } from '$paraglide/messages.js';
	import Icon from '$core/components/Icon.svelte';
	import { faArrowsRotate, faCircleExclamation, faMagnifyingGlassPlus } from '@fortawesome/pro-regular-svg-icons';
	import { Button } from '$core/components/ui/button';
	import { delayed } from '$core/async/delayed.svelte';
	import type { RelatedView } from './searchView';

	interface Props {
		related: RelatedView;
		onMore: () => void;
		onRetry: () => void;
		children: Snippet;
	}

	let { related, onMore, onRetry, children }: Props = $props();

	const uid = $props.id();
	const slow = delayed(() => related.status === 'loading');

	const notice = $derived.by(() => {
		switch (related.status) {
			case 'tooLong':
				return msg.mail_search_related_too_long();
			case 'preparing':
				return msg.mail_search_related_preparing();
			case 'busy':
				return msg.mail_search_related_busy();
			case 'failed':
				return msg.mail_search_related_failed();
			default:
				return null;
		}
	});
	const coverage = $derived.by(() => {
		if (related.status !== 'ready') return null;
		if (related.rebuilding) return msg.mail_search_related_rebuilding();
		if (related.capped > 0) return msg.mail_search_related_capped();
		if (related.incomplete > 0) return msg.mail_search_related_incomplete();
		return null;
	});
	const announce = $derived(related.status === 'ready' && related.rows.length > 0 ? msg.mail_search_related_title() : '');
</script>

<section class={['srch-related', { main: related.main }]} aria-labelledby="{uid}-h" aria-busy={related.status === 'loading'}>
	<header class="sr-head">
		<Icon icon={faMagnifyingGlassPlus} size={14} aria-hidden="true" />
		<div class="sr-titles">
			<h2 id="{uid}-h">{related.main ? msg.mail_search_related_no_exact() : msg.mail_search_related_title()}</h2>
			<p>{related.main ? msg.mail_search_related_similar() : msg.mail_search_related_note()}</p>
		</div>
	</header>
	{#if notice}
		<div class={['sr-state', { warn: related.status === 'failed' || related.status === 'tooLong' }]} role={related.status === 'failed' ? 'alert' : 'status'}>
			{#if related.status === 'failed' || related.status === 'tooLong'}<Icon icon={faCircleExclamation} size={13} aria-hidden="true" />{/if}
			<span>{notice}</span>
			{#if related.status === 'failed' || related.status === 'busy'}
				<Button variant="neutral" size="sm" onclick={onRetry}><Icon icon={faArrowsRotate} size={13} />{msg.common_retry()}</Button>
			{/if}
		</div>
	{:else if related.status === 'loading'}
		<div class="sr-state" role="status">
			{#if slow.visible}<span class="lf-spin" aria-hidden="true"></span><span>{msg.mail_search_related_loading()}</span>{/if}
		</div>
	{:else if related.rows.length === 0}
		<div class="sr-state" role="status"><span>{msg.mail_search_related_empty()}</span></div>
	{/if}
	{#if coverage}
		<div class="sr-state sr-cover"><span>{coverage}</span></div>
	{/if}
	{#if related.status === 'ready' && related.rows.length > 0}
		{@render children()}
		{#if related.more}
			<div class="sr-more">
				<Button variant="neutral" size="sm" onclick={onMore}>{msg.mail_search_related_more()}</Button>
			</div>
		{/if}
	{/if}
	<span class="sr-only" role="status" aria-live="polite">{announce}</span>
</section>
