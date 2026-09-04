<script lang="ts">
	import Eye from '@lucide/svelte/icons/eye';
	import Globe from '@lucide/svelte/icons/globe';
	import Lock from '@lucide/svelte/icons/lock';

	interface Props {
		tone: 'private' | 'busy' | 'external';
		label: string;
	}

	let { tone, label }: Props = $props();

	const Icon = $derived(tone === 'private' ? Lock : tone === 'busy' ? Eye : Globe);
</script>

<span class="pmode {tone}"><Icon size={12} />{label}</span>
