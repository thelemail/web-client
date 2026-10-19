<script lang="ts">
	import { MorphIcon, type MorphIconProps } from 'morphicons/svelte';

	let { size = 17, ...rest }: MorphIconProps = $props();
</script>

<MorphIcon
	{size}
	spring="snappy"
	reducedMotion="user"
	{...rest}
/>
