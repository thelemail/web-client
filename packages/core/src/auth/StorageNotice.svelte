<script lang="ts">
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { boot } from '$core/stores/boot.svelte';
	import { m } from '$paraglide/messages.js';
</script>

{#if boot.storageUnavailable}
	<div class="stnotice" role="status">
		<TriangleAlert size={16} strokeWidth={1.75} />
		<span>{m.auth_storage_blocked()}</span>
	</div>
{/if}
