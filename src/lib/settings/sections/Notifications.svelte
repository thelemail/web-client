<script lang="ts">
	import SecHead from '../SecHead.svelte';
	import type { SettingsState } from '../data';

	interface Props {
		s: SettingsState;
		set: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void;
	}

	let { s, set }: Props = $props();
</script>

<SecHead
	tag="06 — Notifications"
	title="Notifications"
	desc="What reaches you, how much it reveals, and when it stays quiet."
/>
