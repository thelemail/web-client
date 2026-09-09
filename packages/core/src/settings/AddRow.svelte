<script lang="ts">
	import type { Component } from 'svelte';
	import Plus from '@lucide/svelte/icons/plus';

	interface Props {
		icon?: Component;
		label: string;
		onClick?: () => void;
	}

	let { icon: IconComponent = Plus, label, onClick }: Props = $props();
</script>

<button type="button" class="addrow" onclick={onClick}>
	<IconComponent size={16} />{label}
</button>
