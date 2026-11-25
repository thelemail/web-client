<script lang="ts">
	import { followAccountSlot } from '$core/stores/follow-slot.svelte';

	let { children, data } = $props();

	followAccountSlot(
		() => data.accountId,
		() => data.slot
	);
</script>

{@render children()}
