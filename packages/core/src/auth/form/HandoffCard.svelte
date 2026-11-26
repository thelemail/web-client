<script lang="ts">
	import { onDestroy } from 'svelte';
	import Icon from '$core/components/Icon.svelte';
	import { faLock } from '@fortawesome/pro-regular-svg-icons';
	import Rich from '$core/i18n/Rich.svelte';
	import Status from './Status.svelte';
	import { m } from '$paraglide/messages.js';

	const SLOW_AFTER_MS = 10_000;

	let {
		title,
		lede,
		to,
		from = typeof window === 'undefined' ? '' : window.location.host,
		secure = 'to',
		retry
	}: {
		title: string;
		lede: string;
		to: string;
		from?: string;
		secure?: 'to' | 'from';
		retry?: () => void;
	} = $props();

	let slow = $state(false);
	const timer = setTimeout(() => (slow = true), SLOW_AFTER_MS);
	onDestroy(() => clearTimeout(timer));
</script>

{#snippet host(t: string)}<b class="mono">{t}</b>{/snippet}

<div class="card-surface" aria-live="polite" aria-busy="true">
	<div class="af-route" aria-hidden="true">
		<span class="af-host" class:secure={secure === 'from'}>{#if secure === 'from'}<Icon icon={faLock} size={12} />{/if}{from}</span>
		<span class="af-track"><i></i></span>
		<span class="af-host" class:secure={secure === 'to'}>{#if secure === 'to'}<Icon icon={faLock} size={12} />{/if}{to}</span>
	</div>
	<div class="card-head">
		<h1>{title}</h1>
		<p><Rich text={lede} tags={{ b: host }} /></p>
	</div>
	<Status tone="busy">{m.handoff_redirecting()}</Status>
	{#if slow && retry}
		<p class="af-row">
			<span>{m.handoff_slow()}</span>
			<button type="button" class="af-link" onclick={retry}>{m.handoff_retry()}</button>
		</p>
	{/if}
</div>
