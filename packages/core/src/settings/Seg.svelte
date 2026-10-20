<script lang="ts" generics="T extends string">
	import PanelRight from '@lucide/svelte/icons/panel-right';
	import PanelBottom from '@lucide/svelte/icons/panel-bottom';
	import Rows3 from '@lucide/svelte/icons/rows-3';
	import Sun from '@lucide/svelte/icons/sun';
	import Moon from '@lucide/svelte/icons/moon';
	import Monitor from '@lucide/svelte/icons/monitor';
	import Type from '@lucide/svelte/icons/type';
	import Pilcrow from '@lucide/svelte/icons/pilcrow';
	import { getRowNames } from './a11y';

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
		label?: string;
		labelledby?: string;
	}

	let { value, options, onChange, label, labelledby }: Props = $props();

	const row = getRowNames();
	const buttons: HTMLButtonElement[] = $state([]);
	const focusIndex = $derived(Math.max(0, options.findIndex((o) => o.v === value)));

	const KEYS: Record<string, (i: number, n: number) => number> = {
		ArrowRight: (i, n) => (i + 1) % n,
		ArrowDown: (i, n) => (i + 1) % n,
		ArrowLeft: (i, n) => (i - 1 + n) % n,
		ArrowUp: (i, n) => (i - 1 + n) % n,
		Home: () => 0,
		End: (_, n) => n - 1
	};

	function onKey(e: KeyboardEvent, i: number) {
		const step = KEYS[e.key];
		if (!step) return;
		e.preventDefault();
		const next = step(i, options.length);
		onChange(options[next].v);
		buttons[next]?.focus();
	}

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

<div
	class="seg"
	role="radiogroup"
	aria-label={label}
	aria-labelledby={label ? undefined : (labelledby ?? row?.labelId)}
	aria-describedby={labelledby ? undefined : row?.descId}
>
	{#each options as o, i (o.v)}
		{@const Icon = o.icon ? icons[o.icon] : null}
		<button
			bind:this={buttons[i]}
			type="button"
			role="radio"
			aria-checked={value === o.v}
			tabindex={i === focusIndex ? 0 : -1}
			class:on={value === o.v}
			onclick={() => onChange(o.v)}
			onkeydown={(e) => onKey(e, i)}
		>
			{#if Icon}<Icon size={15} aria-hidden="true" />{/if}{o.l}
		</button>
	{/each}
</div>
