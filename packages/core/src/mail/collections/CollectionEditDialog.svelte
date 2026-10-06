<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import { untrack } from 'svelte';
	import Pencil from '@lucide/svelte/icons/pencil';
	import ConfirmDialog from '$core/mail/ConfirmDialog.svelte';
	import { mailCollections } from '$core/stores/mailCollections.svelte';
	import ColorSwatches from './ColorSwatches.svelte';
	import NameField from './NameField.svelte';
	import { collectionErrorText, nameProblem } from './rules';
	import type { CollectionEntry } from './tree';

	interface Props {
		entry: CollectionEntry;
		extraClass?: string;
		onClose: () => void;
	}

	let { entry, extraClass = '', onClose }: Props = $props();

	const uid = $props.id();
	let name = $state(untrack(() => entry.name));
	let color = $state<string | null>(untrack(() => entry.color));
	let busy = $state(false);
	let tried = $state(false);
	let error = $state<string | null>(null);

	const folder = $derived(entry.kind === 'folder');
	const problem = $derived(
		name.trim() === entry.name ? null : nameProblem(mailCollections.nodes, entry.kind, entry.parentId, name, entry.id)
	);
	const unchanged = $derived(name.trim() === entry.name && color === entry.color);

	async function save(e?: SubmitEvent) {
		e?.preventDefault();
		tried = true;
		if (problem || busy) return;
		if (unchanged) {
			onClose();
			return;
		}
		busy = true;
		error = null;
		try {
			await mailCollections.edit(entry.id, { name, color });
			busy = false;
			onClose();
		} catch (err) {
			error = collectionErrorText(err, entry.kind, m.mail_collection_update_failed());
			busy = false;
		}
	}
</script>

{#snippet body()}
	<form class="cc-form cc-dialog-form" onsubmit={save} novalidate>
		<label class="cc-lbl" for={`${uid}-name`}>{folder ? m.mail_collection_folder_name() : m.mail_collection_label_name()}</label>
		<NameField
			bind:value={name}
			kind={entry.kind}
			{problem}
			id={`${uid}-name`}
			label={folder ? m.mail_collection_folder_name() : m.mail_collection_label_name()}
			reveal={tried}
			disabled={busy}
			autofocus
		/>
		<span class="cc-lbl">{m.mail_collection_color()}</span>
		<ColorSwatches bind:value={color} allowNone={folder} disabled={busy} />
	</form>
{/snippet}

<ConfirmDialog
	icon={Pencil}
	title={folder ? m.mail_collection_edit_folder() : m.mail_collection_edit_label()}
	sub={entry.path}
	confirmLabel={m.mail_collection_save()}
	{busy}
	disabled={tried && !!problem}
	{error}
	{body}
	{extraClass}
	onConfirm={() => void save()}
	{onClose}
/>
