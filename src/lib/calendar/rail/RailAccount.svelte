<script lang="ts">
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Mail from '@lucide/svelte/icons/mail';
	import Settings from '@lucide/svelte/icons/settings';
	import User from '@lucide/svelte/icons/user';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Avatar from '$lib/components/Avatar.svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { auth } from '$lib/stores/auth.svelte';
	import { initialsFor } from '$lib/mail/initials';

	const displayName = $derived(auth.fullName ?? auth.email ?? '');
	const displayEmail = $derived(auth.email ?? '');
	const initials = $derived(initialsFor(auth.fullName, auth.email));
	const slot = $derived(page.params.slot ?? '0');
</script>

<div class="rail-acct">
	<DropdownMenu.Root>
		<DropdownMenu.Trigger class="acct-btn">
			<Avatar {initials} src={auth.avatarUrl} fit="cover" size={28} bg="var(--pine-700)" fg="#EEF2EA" />
			<span class="acct-tx">
				<span class="acct-nm" title={displayName}>{displayName}</span>
				<span class="acct-em" title={displayEmail}>{displayEmail}</span>
			</span>
			<span class="uchev"><ChevronDown size={15} /></span>
		</DropdownMenu.Trigger>
		<DropdownMenu.Content class="cal-surface cal-menu w-64" align="start" side="top">
			<DropdownMenu.Item onSelect={() => goto(`/u/${slot}/mail/inbox`)}>
				<Mail size={17} />Go to Mail
			</DropdownMenu.Item>
			<DropdownMenu.Item onSelect={() => goto(`/u/${slot}/settings/profile`)}>
				<User size={17} />Profile
			</DropdownMenu.Item>
			<DropdownMenu.Item onSelect={() => goto(`/u/${slot}/settings/account`)}>
				<Settings size={17} />Settings
			</DropdownMenu.Item>
		</DropdownMenu.Content>
	</DropdownMenu.Root>
</div>
