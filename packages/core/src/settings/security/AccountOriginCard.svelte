<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import { Button } from '$core/components/ui/button';
	import { productTarget } from '$core/products';
	import Card from '../Card.svelte';
	import Row from '../Row.svelte';

	const href = productTarget('auth')?.origin ?? null;
</script>

<Card icon={ShieldCheck} title={m.settings_security_account_origin_title()}>
	<Row t={m.settings_security_account_origin_title()} d={m.settings_security_account_origin_desc()}>
		{#if href}
			<Button variant="secondary" size="sm" {href}>
				{m.settings_security_account_origin_cta()}<ExternalLink size={14} />
			</Button>
		{/if}
	</Row>
</Card>
