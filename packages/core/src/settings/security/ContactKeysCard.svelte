<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import Users from '@lucide/svelte/icons/users';
	import Upload from '@lucide/svelte/icons/upload';
	import CardHead from '../CardHead.svelte';
	import Row from '../Row.svelte';
	import ImportKeyDialog from '../ImportKeyDialog.svelte';
	import { Button } from '$core/components/ui/button';

	let importOpen = $state(false);
</script>

<div class="scard">
	<CardHead icon={Users} title={m.settings_security_contact_keys_title()} />
	<Row t={m.settings_security_contact_keys_row()} d={m.settings_security_contact_keys_desc()}>
		<Button variant="secondary" size="sm" onclick={() => (importOpen = true)}>
			<Upload size={14} />{m.settings_security_contact_keys_import()}
		</Button>
	</Row>
</div>

{#if importOpen}
	<ImportKeyDialog onClose={() => (importOpen = false)} />
{/if}
