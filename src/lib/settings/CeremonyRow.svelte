<script lang="ts">
	import type { Component } from 'svelte';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';

	interface Props {
		icon: Component;
		title: string;
		desc: string;
		status?: string;
		statusKind?: 'ok' | 'neutral';
		cta: string;
		tone?: 'danger';
		onLaunch: () => void;
	}

	let {
		icon: IconComponent,
		title,
		desc,
		status,
		statusKind = 'neutral',
		cta,
		tone,
		onLaunch
	}: Props = $props();
</script>

<div class={'ceremony-row' + (tone ? ' tone-' + tone : '')}>
	<span class="cr-ic"><IconComponent size={20} /></span>
	<div class="cr-body">
		<div class="cr-title">
			{title}
			{#if status}<span class={'cr-status s-' + statusKind}>{status}</span>{/if}
		</div>
		<div class="cr-desc">{desc}</div>
	</div>
	<button
		type="button"
		class={'btn btn-sm ' + (tone === 'danger' ? 'btn-danger' : 'btn-secondary')}
		onclick={onLaunch}
	>
		{cta}<ArrowRight size={14} />
	</button>
</div>
