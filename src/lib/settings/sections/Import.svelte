<script lang="ts">
	import Upload from '@lucide/svelte/icons/upload';
	import FileUp from '@lucide/svelte/icons/file-up';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import CopyCheck from '@lucide/svelte/icons/copy-check';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import Clock from '@lucide/svelte/icons/clock';
	import Lock from '@lucide/svelte/icons/lock';
	import SecHead from '../SecHead.svelte';
	import CardHead from '../CardHead.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { mailbox } from '$lib/stores/mailbox.svelte';
	import { DEFAULT_QUERY } from '$lib/mail/url';
	import { importBatch, type ImportItemStatus } from '$lib/mail/import/importBatch.svelte';

	let fileInput = $state<HTMLInputElement>();
	let dragging = $state(false);
	let loaded = false;

	$effect(() => {
		const id = auth.accountId;
		if (!id || loaded) return;
		loaded = true;
		void importBatch.load(id);
	});

	const statusMeta: Record<ImportItemStatus, { icon: typeof CircleCheck; label: string; cls: string }> = {
		pending: { icon: Clock, label: 'Queued', cls: 'pending' },
		processing: { icon: LoaderCircle, label: 'Importing', cls: 'processing' },
		done: { icon: CircleCheck, label: 'Imported', cls: 'done' },
		duplicate: { icon: CopyCheck, label: 'Already imported', cls: 'dup' },
		failed: { icon: TriangleAlert, label: 'Failed', cls: 'failed' }
	};

	function fmtSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	async function refreshMailbox() {
		try {
			await Promise.all([mailbox.refreshCounts(), mailbox.refresh([DEFAULT_QUERY])]);
		} catch {
		}
	}

	async function startRun() {
		await importBatch.run(() => void refreshMailbox());
	}

	async function ingest(files: File[]) {
		const emls = files.filter((f) => /\.eml$/i.test(f.name) || f.type === 'message/rfc822');
		if (emls.length === 0) return;
		await importBatch.addFiles(emls);
		void startRun();
	}

	function onPick(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		if (input.files) void ingest([...input.files]);
		input.value = '';
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		dragging = false;
		if (e.dataTransfer?.files) void ingest([...e.dataTransfer.files]);
	}

	function onDragOver(e: DragEvent) {
		e.preventDefault();
		dragging = true;
	}

	function openPicker() {
		fileInput?.click();
	}

	function onZoneKey(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			openPicker();
		}
	}
</script>

<SecHead
	tag="06 — Import"
	title="Import"
	desc="Bring existing mail into Thelemail from .eml files. Each message is parsed and encrypted to your key in this browser before it is uploaded — the server only ever stores ciphertext. Imported mail lands in your inbox, marked read, at its original date."
/>

<div class="scard">
	<CardHead icon={Upload} title="Import .eml files" />

	{#if importBatch.locked}
		<div class="card-note warn">
			<Lock size={13} />
			<span>Your vault is locked — unlock it to finish importing the remaining files.</span>
		</div>
	{/if}

	{#if !importBatch.running && importBatch.resumable > 0}
		<div class="card-note">
			<Clock size={13} />
			<span>
				{importBatch.resumable}
				{importBatch.resumable === 1 ? 'file is' : 'files are'} still queued from a previous session.
				<button type="button" class="notelink" onclick={startRun}>Resume import</button>.
			</span>
		</div>
	{/if}

	<div
		class="dropzone"
		class:drag={dragging}
		role="button"
		tabindex="0"
		onclick={openPicker}
		onkeydown={onZoneKey}
		ondrop={onDrop}
		ondragover={onDragOver}
		ondragleave={() => (dragging = false)}
	>
		<FileUp size={26} />
		<div class="dz-t">Drop .eml files here, or click to choose</div>
		<div class="dz-d">You can select hundreds at once — importing runs in the background.</div>
	</div>
	<input
		bind:this={fileInput}
		type="file"
		accept=".eml,message/rfc822"
		multiple
		class="hidden-input"
		onchange={onPick}
	/>

	{#if importBatch.items.length > 0}
		<div class="imp-summary">
			<span class="imp-stat"><CircleCheck size={14} />{importBatch.done} imported</span>
			{#if importBatch.duplicate > 0}
				<span class="imp-stat dup"><CopyCheck size={14} />{importBatch.duplicate} already had</span>
			{/if}
			{#if importBatch.failed > 0}
				<span class="imp-stat failed"><TriangleAlert size={14} />{importBatch.failed} failed</span>
			{/if}
			{#if importBatch.pending > 0}
				<span class="imp-stat pending">
					{#if importBatch.running}<LoaderCircle size={14} class="spin" />{:else}<Clock size={14} />{/if}
					{importBatch.pending} to go
				</span>
			{/if}
			<span class="imp-spacer"></span>
			{#if !importBatch.running && (importBatch.done + importBatch.duplicate + importBatch.failed) > 0}
				<button type="button" class="btn btn-ghost btn-sm" onclick={() => void importBatch.clearCompleted()}>
					Clear finished
				</button>
			{/if}
		</div>

		<div class="imp-list">
			{#each importBatch.items as item (item.id)}
				{@const meta = statusMeta[item.status]}
				{@const Ic = meta.icon}
				<div class="imp-row {meta.cls}">
					<span class="imp-ic"><Ic size={16} class={item.status === 'processing' ? 'spin' : ''} /></span>
					<div class="imp-info">
						<div class="imp-name">{item.name}</div>
						<div class="imp-meta">
							{fmtSize(item.size)} · {meta.label}{item.error ? ` — ${item.error}` : ''}
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.hidden-input {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		border: 0;
	}
	.dropzone {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 30px 18px;
		border: 1.5px dashed var(--border);
		border-radius: 12px;
		color: var(--text-2, var(--muted-700));
		background: var(--surface-2, transparent);
		cursor: pointer;
		text-align: center;
		transition: border-color 0.15s, background 0.15s;
	}
	.dropzone:hover,
	.dropzone:focus-visible {
		border-color: var(--accent-600, var(--accent));
		outline: none;
	}
	.dropzone.drag {
		border-color: var(--accent-600, var(--accent));
		background: var(--accent-50, rgba(0, 0, 0, 0.03));
	}
	.dz-t {
		font-weight: 600;
		color: var(--text-1, inherit);
	}
	.dz-d {
		font-size: 0.82rem;
	}
	.imp-summary {
		display: flex;
		align-items: center;
		gap: 14px;
		flex-wrap: wrap;
		margin-top: 16px;
		font-size: 0.85rem;
		font-weight: 600;
	}
	.imp-stat {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		color: var(--success-700);
	}
	.imp-stat.dup {
		color: var(--muted-700, var(--text-2));
	}
	.imp-stat.failed {
		color: var(--danger-700);
	}
	.imp-stat.pending {
		color: var(--text-2, var(--muted-700));
	}
	.imp-spacer {
		flex: 1;
	}
	.imp-list {
		margin-top: 12px;
		display: flex;
		flex-direction: column;
		max-height: 360px;
		overflow-y: auto;
		border: 1px solid var(--border);
		border-radius: 10px;
	}
	.imp-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 9px 12px;
		border-bottom: 1px solid var(--border);
	}
	.imp-row:last-child {
		border-bottom: none;
	}
	.imp-ic {
		display: inline-flex;
		color: var(--text-2, var(--muted-700));
	}
	.imp-row.done .imp-ic {
		color: var(--success-700);
	}
	.imp-row.failed .imp-ic {
		color: var(--danger-700);
	}
	.imp-info {
		min-width: 0;
		flex: 1;
	}
	.imp-name {
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.imp-meta {
		font-size: 0.8rem;
		color: var(--text-2, var(--muted-700));
	}
	.notelink {
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		color: var(--accent-700, var(--accent));
		font-weight: 600;
		text-decoration: underline;
		text-underline-offset: 2px;
		cursor: pointer;
	}
	:global(.spin) {
		animation: imp-spin 0.9s linear infinite;
	}
	@keyframes imp-spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
