<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import LinkIcon from '@lucide/svelte/icons/link';
	import { untrack } from 'svelte';
	import ConfirmDialog from '../ConfirmDialog.svelte';

	interface Props {
		initial: string;
		onApply: (url: string) => void;
		onClose: () => void;
	}

	let { initial, onApply, onClose }: Props = $props();

	let value = $state(untrack(() => initial));

	const trimmed = $derived(value.trim());
	const removing = $derived(trimmed === '' && initial !== '');

	function focusInput(node: HTMLInputElement) {
		node.focus();
		node.select();
	}

	function apply() {
		if (trimmed === '' && initial === '') return;
		onApply(trimmed);
	}
</script>

<ConfirmDialog
	icon={LinkIcon}
	title={initial ? m.mail_link_edit_title() : m.mail_link_insert_title()}
	confirmLabel={removing ? m.mail_link_remove() : m.mail_link_apply()}
	disabled={trimmed === '' && initial === ''}
	onConfirm={apply}
	{onClose}
>
	{#snippet body()}
		<label class="cfd-field">
			<span class="cfd-label">{m.mail_link_address()}</span>
			<input
				{@attach focusInput}
				bind:value
				class="cfd-input"
				type="url"
				inputmode="url"
				autocomplete="off"
				spellcheck={false}
				placeholder="example.com"
				onkeydown={(e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						apply();
					}
				}}
			/>
		</label>
	{/snippet}
</ConfirmDialog>
