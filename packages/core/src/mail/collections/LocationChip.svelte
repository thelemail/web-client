<script lang="ts">
	import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
	import Icon from '$core/components/Icon.svelte';
	import {
		faAlarmClock,
		faBoxArchive,
		faFolder,
		faInbox,
		faPaperPlane,
		faShieldExclamation,
		faTrashCan
	} from '@fortawesome/pro-regular-svg-icons';
	import { locationLabel, type MailLocation } from '../location';

	interface Props {
		location: MailLocation;
	}

	let { location }: Props = $props();

	const icons: Record<string, IconDefinition> = {
		inbox: faInbox,
		archive: faBoxArchive,
		sent: faPaperPlane,
		snoozed: faAlarmClock,
		spam: faShieldExclamation,
		trash: faTrashCan
	};

	const glyph = $derived(location.custom ? faFolder : (icons[location.route] ?? faFolder));
	const described = $derived(locationLabel(location));
</script>

<span class="locchip" title={described}>
	<Icon icon={glyph} size={11} aria-hidden="true" />
	<span class="locchip-name" aria-hidden="true">{location.name}</span>
	<span class="sr-only">{described}</span>
</span>
