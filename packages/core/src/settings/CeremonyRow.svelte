<script lang="ts">
	import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
	import Icon from '$core/components/Icon.svelte';
	import { faArrowRight } from '@fortawesome/pro-regular-svg-icons';
	import { Button } from '$core/components/ui/button';
	import Heading from './Heading.svelte';

	interface Props {
		icon: IconDefinition;
		title: string;
		desc: string;
		status?: string;
		statusKind?: 'ok' | 'neutral';
		cta: string;
		tone?: 'danger';
		onLaunch: () => void;
	}

	let {
		icon,
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
	<span class="cr-ic"><Icon {icon} size={20} /></span>
	<div class="cr-body">
		<div class="cr-title">
			<Heading>{title}</Heading>
			{#if status}<span class={'cr-status s-' + statusKind}>{status}</span>{/if}
		</div>
		<div class="cr-desc">{desc}</div>
	</div>
	<Button variant={tone === 'danger' ? 'danger' : 'secondary'} size="sm" onclick={onLaunch}>
		{cta}<Icon icon={faArrowRight} size={14} />
	</Button>
</div>
