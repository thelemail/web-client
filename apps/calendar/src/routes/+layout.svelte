<script lang="ts">
	import './layout.css';
	import * as Tooltip from '$core/components/ui/tooltip';
	import favicon from '$core/assets/favicon.svg';
	import AccountTransition from '$core/components/AccountTransition.svelte';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
</svelte:head>
<Tooltip.Provider delayDuration={350}>
	<div data-app-ready style="display: contents">{@render children()}</div>
</Tooltip.Provider>
<AccountTransition />
