<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import Icon from '$core/components/Icon.svelte';
	import { faUpload, faUsers } from '@fortawesome/pro-regular-svg-icons';
	import Card from '../Card.svelte';
	import Row from '../Row.svelte';
	import ImportKeyDialog from '../ImportKeyDialog.svelte';
	import { Button } from '$core/components/ui/button';

	let importOpen = $state(false);
</script>

<Card icon={faUsers} title={m.settings_security_contact_keys_title()}>
	<Row t={m.settings_security_contact_keys_row()} d={m.settings_security_contact_keys_desc()}>
		<Button variant="tonal" size="sm" onclick={() => (importOpen = true)}>
			<Icon icon={faUpload} size={14} />{m.settings_security_contact_keys_import()}
		</Button>
	</Row>
</Card>

{#if importOpen}
	<ImportKeyDialog onClose={() => (importOpen = false)} />
{/if}
