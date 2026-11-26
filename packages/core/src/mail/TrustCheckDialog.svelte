<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import { Button } from '$core/components/ui/button';
	import * as Dialog from '$core/components/ui/dialog';
	import { faCheck, faMinus, faXmark } from '@fortawesome/pro-regular-svg-icons';
	import type { TrustCheck } from './trust';

	interface Props {
		check: TrustCheck;
		onClose: () => void;
	}

	let { check, onClose }: Props = $props();

	const glyph = $derived(check.state === 'pass' ? faCheck : check.state === 'fail' ? faXmark : faMinus);
	const tone = $derived(check.state === 'pass' ? 'success' : check.state === 'fail' ? 'danger' : 'neutral');
</script>

<Dialog.Root
	bind:open={
		() => true,
		(open) => {
			if (!open) onClose();
		}
	}
>
	<Dialog.Content size="sm">
		<Dialog.Header icon={glyph} {tone}>
			<Dialog.Title>{check.label}</Dialog.Title>
			<Dialog.Description>{check.explain}</Dialog.Description>
		</Dialog.Header>
		{#if check.rows.length > 0}
			<dl class="tcd-rows">
				{#each check.rows as row, i (row.label + i)}
					<div>
						<dt>{row.label}</dt>
						<dd>{row.value}</dd>
					</div>
				{/each}
			</dl>
		{/if}
		<Dialog.Footer>
			<Button variant="neutral" onclick={onClose}>{m.common_close()}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<style>
	.tcd-rows {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin: 0;
		padding-top: 12px;
		border-top: 1px solid var(--border-soft);
	}
	.tcd-rows div {
		display: grid;
		grid-template-columns: 116px 1fr;
		gap: 10px;
		align-items: baseline;
	}
	.tcd-rows dt {
		color: var(--fg-faint);
		font-size: 11.5px;
	}
	.tcd-rows dd {
		margin: 0;
		color: var(--fg);
		font-family: var(--font-mono);
		font-size: 11px;
		line-height: 1.5;
		word-break: break-word;
	}
</style>
