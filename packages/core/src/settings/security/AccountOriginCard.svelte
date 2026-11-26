<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import Icon from '$core/components/Icon.svelte';
	import { faArrowUpRightFromSquare } from '@fortawesome/pro-regular-svg-icons';
	import { Button } from '$core/components/ui/button';
	import { productTarget } from '$core/products';
	import Card from '../Card.svelte';
	import Row from '../Row.svelte';

	const href = productTarget('auth')?.origin ?? null;
</script>

<Card title={m.settings_security_account_origin_title()}>
	<Row t={m.settings_security_account_origin_title()} d={m.settings_security_account_origin_desc()}>
		{#if href}
			<Button variant="neutral" size="sm" {href}>
				{m.settings_security_account_origin_cta()}<Icon icon={faArrowUpRightFromSquare} size={14} />
			</Button>
		{/if}
	</Row>
</Card>
