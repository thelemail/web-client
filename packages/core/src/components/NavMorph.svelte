<script lang="ts">
	import { MorphIcon, type MorphIconProps } from 'morphicons/svelte';
	import { preferences } from '$core/stores/preferences.svelte';

	let { size = 17, ...rest }: MorphIconProps = $props();
</script>

<MorphIcon
	{size}
	spring="snappy"
	reducedMotion={preferences.reduceMotion ? 'always' : 'user'}
	{...rest}
/>
