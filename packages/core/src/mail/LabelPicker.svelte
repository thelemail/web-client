<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import { mailCollections } from '$core/stores/mailCollections.svelte';
	import { accountSettings } from '$core/stores/accountSettings.svelte';
	import { Button } from '$core/components/ui/button';
	import CollectionPicker from './collections/CollectionPicker.svelte';
	import { collectionColor } from './collections/palette';
	import {
		createTarget,
		labelChanges,
		nextCheckState,
		searchEntries,
		type CheckState,
		type PickerRow,
		type PickerSection
	} from './collections/picker';
	import type { CollectionEntry } from './collections/tree';

	interface Props {
		anchor: HTMLElement | undefined;
		initial: ReadonlyMap<string, CheckState>;
		onApply: (add: string[], remove: string[]) => void;
		onClose: () => void;
	}

	let { anchor, initial, onApply, onClose }: Props = $props();

	const RECENT_LIMIT = 5;

	let query = $state('');
	let staged = $state<Record<string, CheckState>>({});

	const labels = $derived(mailCollections.labels.filter((l) => !l.sealed));
	const stagedMap = $derived(new Map(Object.entries(staged)));
	const changes = $derived(labelChanges(initial, stagedMap));
	const dirty = $derived(changes.add.length + changes.remove.length > 0);

	function stateOf(id: string): CheckState {
		return staged[id] ?? initial.get(id) ?? 'off';
	}

	function toggle(id: string) {
		staged[id] = nextCheckState(stateOf(id), initial.get(id) ?? 'off');
	}

	function parentPath(e: CollectionEntry): string | undefined {
		return e.depth > 0 ? e.path.slice(0, e.path.length - e.name.length - 3) : undefined;
	}

	function row(prefix: string, e: CollectionEntry, tree: boolean): PickerRow {
		return {
			key: `${prefix}:${e.id}`,
			title: e.name,
			path: tree ? undefined : parentPath(e),
			depth: tree ? e.depth : 0,
			dot: collectionColor(e.color),
			check: stateOf(e.id),
			pick: () => toggle(e.id)
		};
	}

	const sections = $derived.by<PickerSection[]>(() => {
		const q = query.trim();
		if (q) return [{ key: 'matches', rows: searchEntries(labels, q).map((l) => row('match', l, false)) }];
		const recent = accountSettings.mailRecents.labels
			.map((id) => labels.find((l) => l.id === id))
			.filter((l): l is CollectionEntry => !!l)
			.slice(0, RECENT_LIMIT);
		return [
			{ key: 'recent', title: m.mail_picker_recent(), rows: recent.map((l) => row('recent', l, false)) },
			{
				key: 'favorites',
				title: m.mail_sidebar_favorites(),
				rows: labels.filter((l) => l.favorite).map((l) => row('fav', l, false))
			},
			{ key: 'all', title: m.mail_list_labels(), rows: labels.map((l) => row('all', l, true)) }
		];
	});

	const create = $derived.by(() => {
		const target = createTarget(mailCollections.labels, query);
		if (!target) return null;
		const parent = target.parent?.id ?? null;
		if (!target.name) return { text: m.mail_collection_new_label(), name: '', parent };
		const text = target.parent
			? m.mail_picker_create_label_in({ name: target.name, parent: target.parent.path })
			: m.mail_picker_create_label({ name: target.name });
		return { text, name: target.name, parent };
	});

	function apply() {
		if (dirty) onApply(changes.add, changes.remove);
		onClose();
	}
</script>

<CollectionPicker
	{anchor}
	label={m.mail_list_labels()}
	placeholder={m.mail_collection_move_find_label()}
	bind:query
	{sections}
	multi
	createKind="label"
	{create}
	onCreated={(entry) => (staged[entry.id] = 'on')}
	onCancel={onClose}
	onDismiss={apply}
	onSubmit={apply}
>
	{#snippet footer()}
		<div class="pk-foot">
			<Button type="button" variant="primary" size="sm" disabled={!dirty} onclick={apply}>
				{m.mail_picker_apply()}
			</Button>
		</div>
	{/snippet}
</CollectionPicker>
