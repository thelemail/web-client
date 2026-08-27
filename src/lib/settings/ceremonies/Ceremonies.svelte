<script lang="ts">
	import RecoveryCeremony from './RecoveryCeremony.svelte';
	import PasswordCeremony from './PasswordCeremony.svelte';
	import TwoFactorCeremony from './TwoFactorCeremony.svelte';
	import KeysCeremony from './KeysCeremony.svelte';
	import DeleteCeremony from './DeleteCeremony.svelte';
	import AddDomainCeremony from './AddDomainCeremony.svelte';
	import AddAddressCeremony from './AddAddressCeremony.svelte';
	import AddMemberCeremony from './AddMemberCeremony.svelte';
	import type { CeremonyKind, TwoFaSetupMethod } from '../data';

	interface Props {
		active: CeremonyKind | null;
		twoFaMethod?: TwoFaSetupMethod;
		onClose: () => void;
		onComplete: (k: CeremonyKind) => void;
	}

	let { active, twoFaMethod, onClose, onComplete }: Props = $props();
</script>

{#if active === 'recovery'}
	<RecoveryCeremony {onClose} {onComplete} />
{:else if active === 'password'}
	<PasswordCeremony {onClose} {onComplete} />
{:else if active === 'twofa'}
	<TwoFactorCeremony {onClose} {onComplete} initialMethod={twoFaMethod} />
{:else if active === 'keys'}
	<KeysCeremony {onClose} {onComplete} />
{:else if active === 'delete'}
	<DeleteCeremony {onClose} {onComplete} />
{:else if active === 'domain'}
	<AddDomainCeremony {onClose} {onComplete} />
{:else if active === 'address'}
	<AddAddressCeremony {onClose} {onComplete} />
{:else if active === 'member'}
	<AddMemberCeremony {onClose} {onComplete} />
{/if}
