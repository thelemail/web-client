<script lang="ts">
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { boot } from '$lib/stores/boot.svelte';
</script>

{#if boot.storageUnavailable}
	<div class="stnotice" role="status">
		<TriangleAlert size={16} strokeWidth={1.75} />
		<span
			>This browser is blocking Thelemail's local storage, so accounts saved on this device can't
			be read. Close other Thelemail tabs and reload, or sign in again.</span
		>
	</div>
{/if}
