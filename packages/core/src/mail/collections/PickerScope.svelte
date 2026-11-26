<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import { Segmented } from '$core/components/ui/segmented';

	type Scope = 'conversation' | 'message';

	interface Props {
		text?: string;
		toggle?: { value: Scope; count: number; onChange: (scope: Scope) => void } | null;
		future?: boolean;
	}

	let { text = '', toggle = null, future = false }: Props = $props();
</script>

{#if toggle || text || future}
	<div class="pk-scope">
		{#if toggle}
			<div class="pk-seg" role="presentation" onmousedown={(e) => e.preventDefault()}>
				<Segmented
					block
					aria-label={m.mail_scope_label()}
					bind:value={() => toggle?.value, (v) => toggle?.onChange(v)}
					options={[
						{ value: 'conversation', label: m.mail_scope_conversation({ count: toggle.count }) },
						{ value: 'message', label: m.mail_scope_latest() }
					]}
				/>
			</div>
		{:else if text}
			<p class="pk-scope-text">{text}</p>
		{/if}
		{#if future}
			<p class="pk-scope-note">{m.mail_scope_future()}</p>
		{/if}
	</div>
{/if}
