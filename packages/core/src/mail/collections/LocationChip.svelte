<script lang="ts">
	import FolderIcon from '@lucide/svelte/icons/folder';
	import Inbox from '@lucide/svelte/icons/inbox';
	import Archive from '@lucide/svelte/icons/archive';
	import Send from '@lucide/svelte/icons/send';
	import AlarmClock from '@lucide/svelte/icons/alarm-clock';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { locationLabel, type MailLocation } from '../location';

	interface Props {
		location: MailLocation;
	}

	let { location }: Props = $props();

	const icons: Record<string, typeof FolderIcon> = {
		inbox: Inbox,
		archive: Archive,
		sent: Send,
		snoozed: AlarmClock,
		spam: ShieldAlert,
		trash: Trash2
	};

	const Icon = $derived(location.custom ? FolderIcon : (icons[location.route] ?? FolderIcon));
	const described = $derived(locationLabel(location));
</script>

<span class="locchip" title={described}>
	<Icon size={11} aria-hidden="true" />
	<span class="locchip-name" aria-hidden="true">{location.name}</span>
	<span class="sr-only">{described}</span>
</span>
