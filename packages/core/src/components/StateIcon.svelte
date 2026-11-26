<script lang="ts" module>
	export type Gesture = 'drop' | 'fly' | 'fly-level' | 'spin' | 'ring' | 'shake' | 'pulse' | 'tilt';
</script>

<script lang="ts">
	import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
	import Icon from './Icon.svelte';

	interface Props {
		icon: IconDefinition;
		activeIcon?: IconDefinition;
		active?: boolean;
		gesture?: Gesture;
		size?: number | string;
		class?: string;
	}

	let { icon, activeIcon, active = false, gesture, size = 24, class: className }: Props = $props();

	let el: HTMLSpanElement | undefined = $state();
	let was: boolean | undefined;

	$effect(() => {
		const now = active;
		if (el && gesture && now && was === false) {
			const cls = `go-${gesture}`;
			if (el.classList.contains(cls)) {
				el.classList.remove(cls);
				void el.offsetWidth;
			}
			el.classList.add(cls);
		}
		was = now;
	});

	function done(e: AnimationEvent) {
		const target = e.currentTarget as HTMLElement;
		for (const c of [...target.classList]) if (c.startsWith('go-')) target.classList.remove(c);
	}
</script>

<span bind:this={el} class={['state-icon', className, { on: active }]} onanimationend={done} aria-hidden="true">
	<Icon {icon} {size} class="si-rest" />
	<Icon icon={activeIcon ?? icon} {size} class="si-on" />
</span>

<style>
	.state-icon { display: inline-grid; flex: 0 0 auto; place-items: center; }
	.state-icon > :global(svg) { grid-area: 1 / 1; transition: opacity var(--dur, 200ms) var(--ease, ease); }
	.state-icon > :global(.si-on) { opacity: 0; }
	.state-icon.on > :global(.si-rest) { opacity: 0; }
	.state-icon.on > :global(.si-on) { opacity: 1; }

	.state-icon:global(.go-drop) { animation: drop 520ms var(--ease-out, ease-out); }
	.state-icon:global(.go-fly) { animation: fly 520ms var(--ease-out, ease-out); }
	.state-icon:global(.go-fly-level) { animation: fly-level 520ms var(--ease-out, ease-out); }
	.state-icon:global(.go-spin) { animation: spin 520ms var(--ease-out, ease-out); }
	.state-icon:global(.go-ring) { animation: ring 520ms var(--ease-out, ease-out); }
	.state-icon:global(.go-shake) { animation: shake 520ms var(--ease-out, ease-out); }
	.state-icon:global(.go-pulse) { animation: pulse 520ms var(--ease-out, ease-out); }
	.state-icon:global(.go-tilt) { animation: tilt 520ms var(--ease-out, ease-out); }

	@keyframes drop { 0% { transform: none; } 35% { transform: translateY(3px) scaleY(0.9); } 70% { transform: translateY(-1px); } 100% { transform: none; } }
	@keyframes fly { 0% { transform: none; opacity: 1; } 45% { transform: translate(9px, -9px) scale(0.6); opacity: 0; } 46% { transform: translate(-9px, 9px) scale(0.6); opacity: 0; } 100% { transform: none; opacity: 1; } }
	@keyframes fly-level { 0% { transform: none; opacity: 1; } 45% { transform: translateX(11px) scale(0.7); opacity: 0; } 46% { transform: translateX(-11px) scale(0.7); opacity: 0; } 100% { transform: none; opacity: 1; } }
	@keyframes spin { 0% { transform: rotate(0) scale(1); } 50% { transform: rotate(144deg) scale(1.25); } 100% { transform: rotate(216deg) scale(1); } }
	@keyframes ring { 0%, 100% { transform: rotate(0); } 15% { transform: rotate(-14deg); } 30% { transform: rotate(12deg); } 45% { transform: rotate(-9deg); } 60% { transform: rotate(6deg); } 75% { transform: rotate(-3deg); } }
	@keyframes shake { 0%, 100% { transform: rotate(0); } 25% { transform: rotate(-9deg) translateY(-1px); } 55% { transform: rotate(7deg); } 80% { transform: rotate(-3deg); } }
	@keyframes pulse { 0% { transform: scale(1); } 40% { transform: scale(1.22); } 100% { transform: scale(1); } }
	@keyframes tilt { 0% { transform: rotate(0); } 40% { transform: rotate(-10deg) translateY(-1px); } 100% { transform: rotate(0); } }

	@media (prefers-reduced-motion: reduce) {
		.state-icon > :global(svg) { transition: none; }
		.state-icon:global([class*='go-']) { animation: none; }
	}
</style>
