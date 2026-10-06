<script lang="ts">
	import { tick } from 'svelte';
	import { mailCollections } from '$core/stores/mailCollections.svelte';
	import CollectionDeleteDialog from './CollectionDeleteDialog.svelte';
	import CollectionEditDialog from './CollectionEditDialog.svelte';
	import CollectionMoveDialog from './CollectionMoveDialog.svelte';
	import type { DeletedCollection } from './rules';
	import type { CollectionEntry } from './tree';
	import './collections.css';

	type Mode = 'edit' | 'move' | 'delete';

	interface Props {
		extraClass?: string;
		onDeleted?: (deleted: DeletedCollection) => void;
	}

	let { extraClass = '', onDeleted }: Props = $props();

	let open = $state<{
		mode: Mode;
		id: string;
		last: CollectionEntry;
		returnTo: HTMLElement | null;
	} | null>(null);
	let removed = false;

	const live = $derived(open ? mailCollections.byId(open.id) : undefined);
	const entry = $derived(live ?? open?.last);

	$effect(() => {
		if (open && open.mode !== 'delete' && mailCollections.loaded && !live) close();
	});

	function show(mode: Mode, target: CollectionEntry, returnTo: HTMLElement | null = null) {
		if (target.sealed) return;
		removed = false;
		open = { mode, id: target.id, last: target, returnTo };
	}

	export function edit(target: CollectionEntry, returnTo?: HTMLElement | null) {
		show('edit', target, returnTo);
	}

	export function move(target: CollectionEntry, returnTo?: HTMLElement | null) {
		show('move', target, returnTo);
	}

	export function remove(target: CollectionEntry, returnTo?: HTMLElement | null) {
		show('delete', target, returnTo);
	}

	function close() {
		const returnTo = removed ? null : open?.returnTo;
		open = null;
		if (!returnTo) return;
		void tick().then(() => {
			if (returnTo.isConnected) returnTo.focus();
		});
	}

	function deleted(d: DeletedCollection) {
		removed = true;
		onDeleted?.(d);
	}
</script>

{#if open && entry}
	{#key open}
		{#if open.mode === 'edit'}
			<CollectionEditDialog {entry} extraClass="coll-dialog {extraClass}" onClose={close} />
		{:else if open.mode === 'move'}
			<CollectionMoveDialog {entry} extraClass="coll-dialog {extraClass}" onClose={close} />
		{:else}
			<CollectionDeleteDialog
				{entry}
				extraClass="coll-dialog {extraClass}"
				onDeleted={deleted}
				onClose={close}
			/>
		{/if}
	{/key}
{/if}
