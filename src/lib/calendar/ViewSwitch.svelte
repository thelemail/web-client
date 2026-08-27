<script lang="ts">
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Check from '@lucide/svelte/icons/check';
	import { cal, type View } from './state.svelte';

	const VIEW_OPTS: { id: View; label: string }[] = [
		{ id: 'day', label: 'Day' },
		{ id: '4day', label: '4 days' },
		{ id: 'week', label: 'Week' },
		{ id: 'month', label: 'Month' },
		{ id: 'year', label: 'Year' },
		{ id: 'schedule', label: 'Schedule' }
	];
	const VIEW_LABEL = Object.fromEntries(VIEW_OPTS.map((v) => [v.id, v.label]));

	let open = $state(false);
	let ref: HTMLDivElement | undefined = $state();

	function handleDoc(e: MouseEvent) {
		if (ref && !ref.contains(e.target as Node)) open = false;
	}
	function handleKey(e: KeyboardEvent) {
		if (e.key === 'Escape') open = false;
	}
</script>

<svelte:document onmousedown={handleDoc} onkeydown={handleKey} />

<div class="viewseg" role="tablist">
	{#each VIEW_OPTS as v (v.id)}
		<button
			role="tab"
			aria-selected={cal.view === v.id}
			class:on={cal.view === v.id}
			onclick={() => cal.setView(v.id)}>{v.label}</button
		>
	{/each}
</div>
<div class="viewdrop" bind:this={ref}>
	<button class="viewdrop-btn" onclick={() => (open = !open)}>
		{VIEW_LABEL[cal.view]}<ChevronDown size={15} />
	</button>
	{#if open}
		<div class="menu" style:width="180px">
			{#each VIEW_OPTS as v (v.id)}
				<button class="mitem" class:active={cal.view === v.id} onclick={() => { cal.setView(v.id); open = false; }}>
					{v.label}
					{#if cal.view === v.id}<span class="mi-chev"><Check size={16} /></span>{/if}
				</button>
			{/each}
		</div>
	{/if}
</div>
