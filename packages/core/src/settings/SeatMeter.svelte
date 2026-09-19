<script lang="ts">
	import { m } from '$paraglide/messages.js';

	interface Props {
		used: number;
		total: number;
	}

	let { used, total }: Props = $props();
</script>

<span class="seat-meter" title={m.settings_member_seat_meter({ used, total })}>
	{#each { length: total }, i (i)}
		<span class="seat-dot" class:used={i < used}></span>
	{/each}
</span>
