<script lang="ts">
	import type { Component } from 'svelte';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import { Button } from '$lib/components/ui/button';

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
	<Button variant={tone === 'danger' ? 'danger' : 'secondary'} size="sm" onclick={onLaunch}>
		{cta}<ArrowRight size={14} />
	</Button>
</div>
