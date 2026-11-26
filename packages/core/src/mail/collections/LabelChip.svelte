<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import { Chip } from '$core/components/ui/chip';
	import { collectionColor } from './palette';

	interface Props {
		name: string;
		path: string;
		color: string | null;
		partial?: boolean;
		onRemove?: () => void;
	}

	let { name, path, color, partial = false, onRemove }: Props = $props();

	const described = $derived(partial ? m.mail_label_chip_partial({ label: path }) : path);

	function keepRemoveLocal(e: MouseEvent) {
		if ((e.target as Element).closest('.chip-remove')) e.stopPropagation();
	}
</script>

<Chip
	size="sm"
	class={['lchip', { partial }]}
	title={described}
	removeLabel={onRemove ? m.mail_label_chip_remove({ label: path }) : undefined}
	onremove={onRemove}
	onclick={onRemove ? keepRemoveLocal : undefined}
>
	{#snippet leading()}<span class="lchip-dot" style:background={collectionColor(color)} aria-hidden="true"></span>{/snippet}
	<span aria-hidden={partial || undefined}>{name}</span>
	{#if partial}
		<span class="sr-only">{described}</span>
	{/if}
</Chip>
