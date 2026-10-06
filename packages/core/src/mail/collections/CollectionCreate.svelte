<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import { untrack } from 'svelte';
	import type { MailCollectionKind } from '$core/api/types';
	import { mailCollections } from '$core/stores/mailCollections.svelte';
	import { Button } from '$core/components/ui/button';
	import ColorSwatches from './ColorSwatches.svelte';
	import NameField from './NameField.svelte';
	import { collectionErrorText, MAX_COLLECTION_DEPTH, nameProblem } from './rules';
	import type { CollectionEntry } from './tree';
	import './collections.css';

	interface Props {
		kind: MailCollectionKind;
		parent?: string | null;
		onCreated: (entry: CollectionEntry) => void;
	}

	let { kind, parent = null, onCreated }: Props = $props();

	let name = $state('');
	let parentId = $state(untrack(() => parent ?? ''));
	let color = $state<string | null>(untrack(() => (kind === 'label' ? 'pine' : null)));
	let saving = $state(false);
	let tried = $state(false);
	let error = $state<string | null>(null);

	const parents = $derived(
		(kind === 'folder' ? mailCollections.folders : mailCollections.labels).filter(
			(c) => !c.sealed && c.depth + 1 < MAX_COLLECTION_DEPTH
		)
	);
	const problem = $derived(nameProblem(mailCollections.nodes, kind, parentId || null, name));
	const label = $derived(kind === 'folder' ? m.mail_collection_folder_name() : m.mail_collection_label_name());

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		tried = true;
		if (problem || saving) return;
		saving = true;
		error = null;
		try {
			const entry = await mailCollections.create(kind, name, color, parentId || null);
			onCreated(entry);
		} catch (err) {
			error = collectionErrorText(
				err,
				kind,
				kind === 'folder' ? m.mail_collection_folder_create_failed() : m.mail_collection_label_create_failed()
			);
		} finally {
			saving = false;
		}
	}
</script>

<form class="cc-form" onsubmit={submit} novalidate>
	<NameField bind:value={name} {kind} {problem} {label} reveal={tried} disabled={saving} autofocus />
	{#if parents.length > 0}
		<select bind:value={parentId} aria-label={m.mail_collection_parent()} disabled={saving}>
			<option value="">{m.mail_collection_no_parent()}</option>
			{#each parents as p (p.id)}
				<option value={p.id}>{p.path}</option>
			{/each}
		</select>
	{/if}
	<ColorSwatches bind:value={color} allowNone={kind === 'folder'} disabled={saving} />
	{#if error}
		<div class="cc-err" role="alert">{error}</div>
	{/if}
	<Button type="submit" variant="primary" size="sm" disabled={saving || (tried && !!problem)}>
		{kind === 'folder' ? m.mail_collection_create_folder() : m.mail_collection_create_label()}
	</Button>
</form>
