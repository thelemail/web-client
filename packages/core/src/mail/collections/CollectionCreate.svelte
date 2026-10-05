<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import { untrack } from 'svelte';
	import type { MailCollectionKind } from '$core/api/types';
	import { mailCollections } from '$core/stores/mailCollections.svelte';
	import { CollectionSealError } from './seal';
	import {
		COLLECTION_COLOR_KEYS,
		COLLECTION_COLOR_NAMES,
		COLLECTION_COLORS,
		type CollectionColor
	} from './palette';
	import type { CollectionEntry } from './tree';

	interface Props {
		kind: MailCollectionKind;
		parent?: string | null;
		onCreated: (entry: CollectionEntry) => void;
	}

	let { kind, parent = null, onCreated }: Props = $props();

	const MAX_NAME = 120;

	let name = $state('');
	let parentId = $state(untrack(() => parent ?? ''));
	let color = $state<CollectionColor | null>(untrack(() => (kind === 'label' ? 'pine' : null)));
	let saving = $state(false);
	let error = $state<string | null>(null);

	const parents = $derived(
		(kind === 'folder' ? mailCollections.folders : mailCollections.labels).filter((c) => !c.sealed)
	);
	const trimmed = $derived(name.trim());

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!trimmed || saving) return;
		saving = true;
		error = null;
		try {
			const entry = await mailCollections.create(kind, trimmed, color, parentId || null);
			onCreated(entry);
		} catch (err) {
			error =
				err instanceof CollectionSealError && err.code === 'locked'
					? m.mail_collection_unlock_required()
					: kind === 'folder'
						? m.mail_collection_folder_create_failed()
						: m.mail_collection_label_create_failed();
		} finally {
			saving = false;
		}
	}
</script>

<form class="cc-form" onsubmit={submit}>
	<input
		type="text"
		bind:value={name}
		maxlength={MAX_NAME}
		placeholder={kind === 'folder' ? m.mail_collection_folder_name() : m.mail_collection_label_name()}
		aria-label={kind === 'folder' ? m.mail_collection_folder_name() : m.mail_collection_label_name()}
		{@attach (node) => node.focus()}
	/>
	{#if parents.length > 0}
		<select bind:value={parentId} aria-label={m.mail_collection_parent()}>
			<option value="">{m.mail_collection_no_parent()}</option>
			{#each parents as p (p.id)}
				<option value={p.id}>{p.path}</option>
			{/each}
		</select>
	{/if}
	<div class="cc-colors" role="radiogroup" aria-label={m.mail_collection_color()}>
		{#if kind === 'folder'}
			<button
				type="button"
				class="cc-swatch none"
				class:on={color === null}
				role="radio"
				aria-checked={color === null}
				aria-label={m.mail_collection_no_color()}
				onclick={() => (color = null)}
			></button>
		{/if}
		{#each COLLECTION_COLOR_KEYS as key (key)}
			<button
				type="button"
				class="cc-swatch"
				class:on={color === key}
				style:background={COLLECTION_COLORS[key]}
				role="radio"
				aria-checked={color === key}
				aria-label={COLLECTION_COLOR_NAMES[key]()}
				onclick={() => (color = key)}
			></button>
		{/each}
	</div>
	{#if error}
		<div class="cc-err" role="alert">{error}</div>
	{/if}
	<button type="submit" class="cc-go" disabled={!trimmed || saving}>
		{kind === 'folder' ? m.mail_collection_create_folder() : m.mail_collection_create_label()}
	</button>
</form>
