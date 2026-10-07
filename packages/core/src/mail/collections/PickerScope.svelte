<script lang="ts">
	import { m } from '$paraglide/messages.js';

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
			<div class="pk-seg" role="radiogroup" aria-label={m.mail_scope_label()}>
				<button
					type="button"
					role="radio"
					class:on={toggle.value === 'conversation'}
					aria-checked={toggle.value === 'conversation'}
					onmousedown={(e) => e.preventDefault()}
					onclick={() => toggle?.onChange('conversation')}
				>
					{m.mail_scope_conversation({ count: toggle.count })}
				</button>
				<button
					type="button"
					role="radio"
					class:on={toggle.value === 'message'}
					aria-checked={toggle.value === 'message'}
					onmousedown={(e) => e.preventDefault()}
					onclick={() => toggle?.onChange('message')}
				>
					{m.mail_scope_latest()}
				</button>
			</div>
		{:else if text}
			<p class="pk-scope-text">{text}</p>
		{/if}
		{#if future}
			<p class="pk-scope-note">{m.mail_scope_future()}</p>
		{/if}
	</div>
{/if}
