<script lang="ts">
	import Route from '@lucide/svelte/icons/route';
	import X from '@lucide/svelte/icons/x';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import PersonalTimeline from './PersonalTimeline.svelte';
	import type { LifecycleContext } from './types';

	let {
		ctx,
		onClose,
		onChoose
	}: { ctx: LifecycleContext; onClose: () => void; onChoose: () => void } = $props();

	function handleKey(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}
	function scrimMouseDown(e: MouseEvent) {
		if (e.target === e.currentTarget) onClose();
	}
</script>

<svelte:document onkeydown={handleKey} />

<div class="lc-sheet-scrim" role="presentation" onmousedown={scrimMouseDown}>
	<div
		class="lc-sheet"
		role="dialog"
		aria-label="Your options"
		aria-modal="true"
		tabindex="-1"
		onmousedown={(e) => e.stopPropagation()}
	>
		<div class="lc-sheet-grip"></div>
		<div class="lc-sheet-head">
			<span class="sh-ic"><Route size={20} /></span>
			<span class="sh-tx">
				<p class="eyebrow">Your options</p>
				<h2>Expiry isn't a cliff.</h2>
			</span>
			<button class="sh-x" title="Close" onclick={onClose}><X size={18} /></button>
		</div>
		<p class="lc-sheet-lead">
			If your trial ends, here's the full timeline with your real dates. You stay in control at every
			step — restore or export whenever you like.
		</p>
		<PersonalTimeline {ctx} />
		<div class="lc-sheet-actions">
			<button class="btn btn-primary" onclick={onChoose}><Sparkles size={17} />Choose a plan</button>
			<button class="btn btn-secondary" onclick={onClose}>Keep exploring the trial</button>
		</div>
	</div>
</div>
