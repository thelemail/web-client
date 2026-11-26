<script lang="ts">
	import Icon from '$core/components/Icon.svelte';
	import { faChevronDown, faEnvelope, faGear, faUser } from '@fortawesome/pro-regular-svg-icons';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Avatar from '$core/components/Avatar.svelte';
	import * as DropdownMenu from '$core/components/ui/dropdown-menu';
	import { auth } from '$core/stores/auth.svelte';
	import { initialsFor } from '$core/mail/initials';
	import { m } from '$paraglide/messages.js';

	const displayName = $derived(auth.fullName ?? auth.email ?? '');
	const displayEmail = $derived(auth.email ?? '');
	const initials = $derived(initialsFor(auth.fullName, auth.email));
	const slot = $derived(page.params.slot ?? '0');
</script>

<div class="rail-acct">
	<DropdownMenu.Root>
		<DropdownMenu.Trigger class="acct-btn">
			<Avatar {initials} src={auth.avatarUrl} fit="cover" size={28} bg="var(--pine-100)" fg="var(--pine-700)" />
			<span class="acct-tx">
				<span class="acct-nm" title={displayName}>{displayName}</span>
				<span class="acct-em" title={displayEmail}>{displayEmail}</span>
			</span>
			<span class="uchev"><Icon icon={faChevronDown} size={15} /></span>
		</DropdownMenu.Trigger>
		<DropdownMenu.Content class="w-64" align="start" side="top">
			<DropdownMenu.Item onSelect={() => goto(`/u/${slot}/mail/inbox`)}>
				<Icon icon={faEnvelope} size={17} />{m.cal_account_go_to_mail()}
			</DropdownMenu.Item>
			<DropdownMenu.Item onSelect={() => goto(`/u/${slot}/settings/profile`)}>
				<Icon icon={faUser} size={17} />{m.cal_account_profile()}
			</DropdownMenu.Item>
			<DropdownMenu.Item onSelect={() => goto(`/u/${slot}/settings/account`)}>
				<Icon icon={faGear} size={17} />{m.cal_account_settings()}
			</DropdownMenu.Item>
		</DropdownMenu.Content>
	</DropdownMenu.Root>
</div>
