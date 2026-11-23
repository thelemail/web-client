<script lang="ts" generics="T extends string">
	import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
	import Icon from '$core/components/Icon.svelte';
	import {
		faDisplay,
		faFont,
		faMoon,
		faParagraph,
		faSidebarFlip,
		faSun,
		faTableRows,
		faWindowFlip
	} from '@fortawesome/pro-regular-svg-icons';
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

	const icons: Record<IconName, IconDefinition> = {
		'panel-right': faSidebarFlip,
		'panel-bottom': faWindowFlip,
		'rows-3': faTableRows,
		sun: faSun,
		moon: faMoon,
		monitor: faDisplay,
		type: faFont,
		pilcrow: faParagraph
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
		{@const glyph = o.icon ? icons[o.icon] : null}
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
			{#if glyph}<Icon icon={glyph} size={15} aria-hidden="true" />{/if}{o.l}
		</button>
	{/each}
</div>
