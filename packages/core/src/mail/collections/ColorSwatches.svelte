<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import { COLLECTION_COLOR_KEYS, COLLECTION_COLOR_NAMES, COLLECTION_COLORS } from './palette';

	interface Props {
		value: string | null;
		allowNone?: boolean;
		disabled?: boolean;
	}

	let { value = $bindable(), allowNone = false, disabled = false }: Props = $props();

	const options = $derived<(string | null)[]>(
		allowNone ? [null, ...COLLECTION_COLOR_KEYS] : [...COLLECTION_COLOR_KEYS]
	);
	const current = $derived(options.includes(value) ? value : options[0]);

	let group = $state<HTMLDivElement>();

	function onKeydown(e: KeyboardEvent) {
		const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
		if (!step) return;
		e.preventDefault();
		const at = options.indexOf(current);
		const next = (at + step + options.length) % options.length;
		value = options[next];
		group?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
	}
</script>

<div
	class="cc-colors"
	role="radiogroup"
	aria-label={m.mail_collection_color()}
	tabindex="-1"
	bind:this={group}
	onkeydown={onKeydown}
>
	{#each options as key (key ?? 'none')}
		<button
			type="button"
			class="cc-swatch"
			class:none={key === null}
			class:on={current === key}
			style:background={key ? COLLECTION_COLORS[key as keyof typeof COLLECTION_COLORS] : undefined}
			role="radio"
			aria-checked={current === key}
			aria-label={key ? COLLECTION_COLOR_NAMES[key as keyof typeof COLLECTION_COLOR_NAMES]() : m.mail_collection_no_color()}
			title={key ? COLLECTION_COLOR_NAMES[key as keyof typeof COLLECTION_COLOR_NAMES]() : m.mail_collection_no_color()}
			tabindex={current === key ? 0 : -1}
			{disabled}
			onclick={() => (value = key)}
		></button>
	{/each}
</div>
