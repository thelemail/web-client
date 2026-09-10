<script lang="ts" generics="T extends string">
	import PanelRight from '@lucide/svelte/icons/panel-right';
	import PanelBottom from '@lucide/svelte/icons/panel-bottom';
	import Rows3 from '@lucide/svelte/icons/rows-3';
	import Sun from '@lucide/svelte/icons/sun';
	import Moon from '@lucide/svelte/icons/moon';
	import Monitor from '@lucide/svelte/icons/monitor';
	import Type from '@lucide/svelte/icons/type';
	import Pilcrow from '@lucide/svelte/icons/pilcrow';

	type IconName =
		| 'panel-right'
		| 'panel-bottom'
		| 'rows-3'
		| 'sun'
		| 'moon'
		| 'monitor'
		| 'type'
		| 'pilcrow';

	interface SegOption {
		v: T;
		l: string;
		icon?: IconName;
	}

	interface Props {
		value: T;
		options: SegOption[];
		onChange: (value: T) => void;
	}

	let { value, options, onChange }: Props = $props();

	const icons: Record<IconName, typeof PanelRight> = {
		'panel-right': PanelRight,
		'panel-bottom': PanelBottom,
		'rows-3': Rows3,
		sun: Sun,
		moon: Moon,
		monitor: Monitor,
		type: Type,
		pilcrow: Pilcrow
	};
</script>

<div class="seg">
	{#each options as o (o.v)}
		{@const Icon = o.icon ? icons[o.icon] : null}
		<button type="button" class:on={value === o.v} onclick={() => onChange(o.v)}>
			{#if Icon}<Icon size={15} />{/if}{o.l}
		</button>
	{/each}
</div>
