<script lang="ts">
	import ChevronDown from '@lucide/svelte/icons/chevron-down';

	interface Props {
		value: string;
		options: string[];
		onChange: (value: string) => void;
		narrow?: boolean;
		ariaLabel?: string;
	}

	let { value, options, onChange, narrow = false, ariaLabel }: Props = $props();
</script>

<span class="sel">
	<select
		{value}
		aria-label={ariaLabel}
		style:min-width={narrow ? '0' : undefined}
		onchange={(e) => onChange((e.currentTarget as HTMLSelectElement).value)}
	>
		{#each options as o (o)}
			<option value={o}>{o}</option>
		{/each}
	</select>
	<span class="chev"><ChevronDown size={15} /></span>
</span>
