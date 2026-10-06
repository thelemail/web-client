<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import FolderInput from '@lucide/svelte/icons/folder-input';
	import Search from '@lucide/svelte/icons/search';
	import ConfirmDialog from '$core/mail/ConfirmDialog.svelte';
	import { mailCollections } from '$core/stores/mailCollections.svelte';
	import { ambiguousNames, collectionErrorText, foldName, moveProblem, ruleText } from './rules';
	import { filterEntries, type CollectionEntry } from './tree';

	interface Props {
		entry: CollectionEntry;
		extraClass?: string;
		onClose: () => void;
	}

	let { entry, extraClass = '', onClose }: Props = $props();

	const uid = $props.id();
	const TOP = '';

	let query = $state('');
	let choice = $state<string | null>(null);
	let busy = $state(false);
	let error = $state<string | null>(null);

	const folder = $derived(entry.kind === 'folder');
	const all = $derived(
		(folder ? mailCollections.folders : mailCollections.labels).filter((e) => !e.sealed)
	);
	const filtering = $derived(query.trim().length > 0);
	const shown = $derived(filtering ? filterEntries(all, query) : all);
	const ambiguous = $derived(ambiguousNames(all));

	function reason(target: string | null): string | null {
		if ((entry.parentId ?? null) === target) return m.mail_collection_move_already_here();
		const problem = moveProblem(mailCollections.nodes, entry.id, target);
		return problem ? ruleText(entry.kind, problem) : null;
	}

	const topReason = $derived(reason(null));
	const valid = $derived(choice !== null && !reason(choice === TOP ? null : choice));

	async function move() {
		if (!valid || busy || choice === null) return;
		busy = true;
		error = null;
		try {
			await mailCollections.moveTo(entry.id, choice === TOP ? null : choice);
			busy = false;
			onClose();
		} catch (err) {
			error = collectionErrorText(err, entry.kind, m.mail_collection_update_failed());
			busy = false;
		}
	}

	function focusFirst(node: HTMLElement) {
		const el = node.querySelector<HTMLElement>(
			'input[type="search"], input:checked:not(:disabled), input:not(:disabled), button:not(:disabled)'
		);
		(el ?? node.closest('.cfd-modal')?.querySelector<HTMLElement>('.cfd-actions button'))?.focus();
	}
</script>

{#snippet option(value: string, title: string, depth: number, path: string | null, why: string | null)}
	<label class="cm-opt" class:off={!!why} style:--depth={depth} title={path ?? title}>
		<input
			type="radio"
			name={`${uid}-target`}
			{value}
			bind:group={choice}
			disabled={!!why || busy}
			aria-describedby={why ? `${uid}-${value || 'top'}-why` : undefined}
		/>
		<span class="cm-txt">
			<span class="cm-name">{title}</span>
			{#if path && path !== title}<span class="cm-path">{path}</span>{/if}
			{#if why}<span class="cm-why" id={`${uid}-${value || 'top'}-why`}>{why}</span>{/if}
		</span>
	</label>
{/snippet}

{#snippet body()}
	<div class="cc-body" {@attach focusFirst}>
		<p class="cfd-p">{folder ? m.mail_collection_move_desc_folder() : m.mail_collection_move_desc_label()}</p>
		{#if all.length > 8 || filtering}
			<label class="cm-find">
				<Search size={14} />
				<input
					type="search"
					bind:value={query}
					placeholder={folder ? m.mail_collection_move_find_folder() : m.mail_collection_move_find_label()}
					aria-label={folder ? m.mail_collection_move_find_folder() : m.mail_collection_move_find_label()}
				/>
			</label>
		{/if}
		<div class="cm-list" role="radiogroup" aria-label={m.mail_collection_move_where()}>
			{#if !filtering}
				{@render option(TOP, m.mail_collection_no_parent(), 0, null, topReason)}
			{/if}
			{#each shown as t (t.id)}
				{@render option(t.id, t.name, filtering ? 0 : t.depth + 1, filtering || ambiguous.has(foldName(t.name)) ? t.path : null, reason(t.id))}
			{:else}
				<p class="cm-empty">{m.mail_sidebar_find_empty()}</p>
			{/each}
		</div>
	</div>
{/snippet}

<ConfirmDialog
	icon={FolderInput}
	title={folder ? m.mail_collection_move_folder_title() : m.mail_collection_move_label_title()}
	sub={entry.path}
	confirmLabel={m.mail_collection_move_confirm()}
	{busy}
	disabled={!valid}
	{error}
	{body}
	{extraClass}
	onConfirm={() => void move()}
	{onClose}
/>
