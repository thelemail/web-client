<script lang="ts">
	import Icon from '$core/components/Icon.svelte';
	import { faTriangleExclamation } from '@fortawesome/pro-regular-svg-icons';
	import { boot } from '$core/stores/boot.svelte';
	import { m } from '$paraglide/messages.js';
</script>

{#if boot.storageUnavailable}
	<div class="stnotice" role="status">
		<Icon icon={faTriangleExclamation} size={16} />
		<span>{m.auth_storage_blocked()}</span>
	</div>
{/if}
