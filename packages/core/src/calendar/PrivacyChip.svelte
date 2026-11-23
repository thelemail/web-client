<script lang="ts">
	import Icon from '$core/components/Icon.svelte';
	import { faEye, faGlobe, faLock } from '@fortawesome/pro-regular-svg-icons';

	interface Props {
		tone: 'private' | 'busy' | 'external';
		label: string;
	}

	let { tone, label }: Props = $props();

	const glyph = $derived(tone === 'private' ? faLock : tone === 'busy' ? faEye : faGlobe);
</script>

<span class="pmode {tone}"><Icon icon={glyph} size={12} />{label}</span>
