<script lang="ts">
	import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
	import Icon from '$core/components/Icon.svelte';
	import { faPlus } from '@fortawesome/pro-regular-svg-icons';

	interface Props {
		icon?: IconDefinition;
		label: string;
		onClick?: () => void;
	}

	let { icon = faPlus, label, onClick }: Props = $props();
</script>

<button type="button" class="addrow" onclick={onClick}>
	<Icon {icon} size={16} />{label}
</button>
