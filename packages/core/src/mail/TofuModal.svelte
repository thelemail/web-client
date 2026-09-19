<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Send from '@lucide/svelte/icons/send';
	import { Button } from '$core/components/ui/button';

	interface Recipient {
		name: string;
		email: string;
	}

	interface Props {
		recipient: Recipient;
		previousPinned?: string;
		previousVerifiedAt?: string;
		currentFingerprint?: string;
		shared?: boolean;
		onSendAnyway: () => void;
		onCancel: () => void;
	}

	let {
		recipient,
		previousPinned = '3E81 9A04 C2F7 5B16 88D0 · 7A23 1E69 4C0B F582 90AD',
		previousVerifiedAt = '14 Feb 2026 · v6',
		currentFingerprint = 'F70B 4A29 D183 6C95 22E1 · 8B40 3F7C 19A5 0D6E C214',
		shared = false,
		onSendAnyway,
		onCancel
	}: Props = $props();

	let what = $state(false);

	function handleKey(e: KeyboardEvent) {
		if (e.key === 'Escape') onCancel();
	}

	function scrimMouseDown(e: MouseEvent) {
		if (e.target === e.currentTarget) onCancel();
	}
</script>

<svelte:document onkeydown={handleKey} />

<div
	class="tofu-scrim"
	role="alertdialog"
	aria-modal="true"
	aria-labelledby="tofu-title"
	tabindex="-1"
	onmousedown={scrimMouseDown}
>
	<div class="tofu-modal" role="presentation" onmousedown={(e) => e.stopPropagation()}>
		<div class="tofu-crest"><KeyRound size={22} /></div>
		<div class="tofu-eyebrow">{m.mail_tofu_eyebrow()}</div>
		<h2 class="tofu-title" id="tofu-title">
			{m.mail_tofu_title({ name: recipient.name || recipient.email })}
		</h2>
		<p class="tofu-lede">
			{#if shared}
				{m.mail_tofu_lede_shared()}
			{:else}
				{m.mail_tofu_lede()}
			{/if}
		</p>

		<div class="tofu-fp">
			<div class="tofu-fprow">
				<span class="tofu-fk">{m.mail_tofu_last_verified()}</span>
				<span class="tofu-fv">{previousVerifiedAt}</span>
			</div>
			<div class="tofu-fprow">
				<span class="tofu-fk">{m.mail_tofu_previously_pinned()}</span>
				<span class="tofu-fv mono">{previousPinned}</span>
			</div>
			<div class="tofu-fprow now">
				<span class="tofu-fk">{m.mail_tofu_now()}</span>
				<span class="tofu-fv mono">{currentFingerprint}</span>
			</div>
		</div>

		<button type="button" class="tofu-what" class:open={what} onclick={() => (what = !what)}>
			{m.mail_tofu_what_changed()}
			{#if what}<ChevronUp size={14} />{:else}<ChevronDown size={14} />{/if}
		</button>
		{#if what}
			<div class="tofu-explainer">
				{m.mail_tofu_explainer()}
			</div>
		{/if}

		<div class="tofu-actions">
			<Button variant="secondary" onclick={onCancel}>{m.common_cancel()}</Button>
			<Button variant="caution" onclick={onSendAnyway}>
				<Send size={15} />{m.mail_tofu_send_anyway()}
			</Button>
		</div>
	</div>
</div>
