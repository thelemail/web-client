<script lang="ts">
	import ChevronDown from '@lucide/svelte/icons/chevron-down';

	interface Props {
		value: string;
		options: (string | { v: string; l: string; lang?: string })[];
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
		{#each options as o (typeof o === 'string' ? o : o.v)}
			{#if typeof o === 'string'}
				<option value={o}>{o}</option>
			{:else}
				<option value={o.v} lang={o.lang}>{o.l}</option>
			{/if}
		{/each}
	</select>
	<span class="chev"><ChevronDown size={15} /></span>
</span>
