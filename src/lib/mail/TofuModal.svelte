<script lang="ts">
	import KeyRound from '@lucide/svelte/icons/key-round';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Send from '@lucide/svelte/icons/send';

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
		<div class="tofu-eyebrow">Key change</div>
		<h2 class="tofu-title" id="tofu-title">
			{recipient.name || recipient.email}'s key has changed since you last wrote to them.
		</h2>
		<p class="tofu-lede">
			{#if shared}
				The directory's record verified correctly — but the key is different from the one this
				device pinned the last time you sent to it. A shared address gets a new key whenever the
				people on it change, so this is expected after someone joins or leaves. It can also mean
				someone is standing in for it.
			{:else}
				The directory's record verified correctly — but the key is different from the one this
				device pinned the last time you sent to them. That's normal after a reinstall or a new
				device. It can also mean someone is standing in for them.
			{/if}
		</p>

		<div class="tofu-fp">
			<div class="tofu-fprow">
				<span class="tofu-fk">Last verified</span>
				<span class="tofu-fv">{previousVerifiedAt}</span>
			</div>
			<div class="tofu-fprow">
				<span class="tofu-fk">Previously pinned</span>
				<span class="tofu-fv mono">{previousPinned}</span>
			</div>
			<div class="tofu-fprow now">
				<span class="tofu-fk">Now</span>
				<span class="tofu-fv mono">{currentFingerprint}</span>
			</div>
		</div>

		<button type="button" class="tofu-what" class:open={what} onclick={() => (what = !what)}>
			What changed?
			{#if what}<ChevronUp size={14} />{:else}<ChevronDown size={14} />{/if}
		</button>
		{#if what}
			<div class="tofu-explainer">
				If you can reach this person another way, ask them to confirm the new fingerprint above. If
				it matches what they see on their device, it's safe to continue. If you're unsure, cancel —
				your draft is kept.
			</div>
		{/if}

		<div class="tofu-actions">
			<button type="button" class="tofu-btn ghost" onclick={onCancel}>Cancel</button>
			<button type="button" class="tofu-btn caution" onclick={onSendAnyway}>
				<Send size={15} />Send anyway
			</button>
		</div>
	</div>
</div>
