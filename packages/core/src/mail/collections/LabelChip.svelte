<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import X from '@lucide/svelte/icons/x';
	import { collectionChip, collectionColor } from './palette';

	interface Props {
		name: string;
		path: string;
		color: string | null;
		partial?: boolean;
		onRemove?: () => void;
	}

	let { name, path, color, partial = false, onRemove }: Props = $props();

	const tone = $derived(collectionChip(color));
	const described = $derived(partial ? m.mail_label_chip_partial({ label: path }) : path);
</script>

<span
	class="lchip"
	class:partial
	style:--chip-bg={tone.bg}
	style:--chip-fg={tone.fg}
	title={described}
>
	<span class="lchip-dot" style:background={collectionColor(color)} aria-hidden="true"></span>
	<span class="lchip-name" aria-hidden={partial || undefined}>{name}</span>
	{#if partial}
		<span class="sr-only">{described}</span>
	{/if}
	{#if onRemove}
		<button
			type="button"
			class="lchip-x"
			aria-label={m.mail_label_chip_remove({ label: path })}
			onclick={(e) => {
				e.stopPropagation();
				onRemove();
			}}
		>
			<X size={11} />
		</button>
	{/if}
</span>
