<script lang="ts">
	import './layout.css';
	import favicon from '$core/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
</svelte:head>
<div data-app-ready style="display: contents">{@render children()}</div>
