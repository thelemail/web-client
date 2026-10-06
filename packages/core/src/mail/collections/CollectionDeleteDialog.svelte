<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import type { FolderDestination } from '$core/api/types';
	import ConfirmDialog from '$core/mail/ConfirmDialog.svelte';
	import { Button } from '$core/components/ui/button';
	import { mailCollections } from '$core/stores/mailCollections.svelte';
	import { collectionErrorText, type DeletedCollection } from './rules';
	import { childIds, type CollectionEntry } from './tree';

	interface Props {
		entry: CollectionEntry;
		extraClass?: string;
		onDeleted?: (deleted: DeletedCollection) => void;
		onClose: () => void;
	}

	let { entry, extraClass = '', onDeleted, onClose }: Props = $props();

	const uid = $props.id();

	let destination = $state<FolderDestination>('archive');
	let folderId = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);

	const folder = $derived(entry.kind === 'folder');
	const children = $derived(childIds(mailCollections.nodes, entry.id));
	const parent = $derived(mailCollections.byId(entry.parentId));
	const others = $derived(mailCollections.folders.filter((f) => f.id !== entry.id && !f.sealed));
	const target = $derived(destination === 'folder' ? mailCollections.folder(folderId) : undefined);
	const ready = $derived(
		children.length === 0 && (!folder || destination !== 'folder' || !!target)
	);
	const placeName = $derived(
		destination === 'inbox'
			? m.mail_folder_inbox()
			: destination === 'archive'
				? m.mail_folder_archive()
				: (target?.path ?? m.mail_collection_delete_chosen_folder())
	);

	async function liftChildren() {
		if (busy) return;
		busy = true;
		error = null;
		try {
			for (const id of children) await mailCollections.moveTo(id, entry.parentId);
		} catch (err) {
			error = collectionErrorText(err, entry.kind, m.mail_collection_update_failed());
		} finally {
			busy = false;
		}
	}

	async function remove() {
		if (!ready || busy) return;
		const dest = folder ? { kind: destination, ...(target ? { folderId: target.id } : {}) } : null;
		busy = true;
		error = null;
		try {
			await mailCollections.remove(entry.id, dest ?? undefined);
			busy = false;
			onDeleted?.({ entry, destination: dest });
			onClose();
		} catch (err) {
			error = collectionErrorText(
				err,
				entry.kind,
				folder ? m.mail_collection_delete_folder_failed() : m.mail_collection_delete_label_failed()
			);
			busy = false;
		}
	}
</script>

{#snippet body()}
	{#if children.length > 0}
		<p class="cfd-p">
			{folder
				? m.mail_collection_delete_blocked_folder({ count: children.length })
				: m.mail_collection_delete_blocked_label({ count: children.length })}
		</p>
		<div class="cd-lift">
			<Button variant="secondary" size="sm" disabled={busy} onclick={() => void liftChildren()}>
				{parent
					? m.mail_collection_delete_lift_into({ path: parent.path })
					: m.mail_collection_delete_lift_top()}
			</Button>
		</div>
		<p class="cfd-hint">
			{folder ? m.mail_collection_delete_blocked_hint_folder() : m.mail_collection_delete_blocked_hint_label()}
		</p>
	{:else if folder}
		<fieldset class="cd-dest" disabled={busy}>
			<legend class="cc-lbl">{m.mail_collection_delete_where()}</legend>
			<label class="cd-opt">
				<input type="radio" name={`${uid}-dest`} value="archive" bind:group={destination} />
				<span>{m.mail_folder_archive()}</span>
			</label>
			<label class="cd-opt">
				<input type="radio" name={`${uid}-dest`} value="inbox" bind:group={destination} />
				<span>{m.mail_folder_inbox()}</span>
			</label>
			{#if others.length > 0}
				<label class="cd-opt">
					<input type="radio" name={`${uid}-dest`} value="folder" bind:group={destination} />
					<span>{m.mail_collection_delete_other_folder()}</span>
				</label>
				{#if destination === 'folder'}
					<select class="cd-select" bind:value={folderId} aria-label={m.mail_collection_delete_other_folder()}>
						<option value="" disabled>{m.mail_collection_delete_pick_folder()}</option>
						{#each others as f (f.id)}
							<option value={f.id}>{f.path}</option>
						{/each}
					</select>
				{/if}
			{/if}
		</fieldset>
		<p class="cfd-p">{m.mail_collection_delete_folder_body({ place: placeName })}</p>
		<p class="cfd-hint">{m.mail_collection_delete_folder_hint({ place: placeName })}</p>
	{:else}
		<p class="cfd-p">{m.mail_collection_delete_label_body()}</p>
	{/if}
{/snippet}

<ConfirmDialog
	icon={Trash2}
	tone="danger"
	title={folder ? m.mail_collection_delete_folder_title() : m.mail_collection_delete_label_title()}
	sub={entry.path}
	confirmLabel={folder ? m.mail_collection_delete_folder() : m.mail_collection_delete_label()}
	{busy}
	disabled={!ready}
	{error}
	{body}
	{extraClass}
	onConfirm={() => void remove()}
	{onClose}
/>
