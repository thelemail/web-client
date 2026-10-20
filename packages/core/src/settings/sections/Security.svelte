<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import SecHead from '../SecHead.svelte';
	import SecGroup from '../security/SecGroup.svelte';
	import RecoveryHero from '../security/RecoveryHero.svelte';
	import SignInCard from '../security/SignInCard.svelte';
	import SessionsCard from '../security/SessionsCard.svelte';
	import KeysCard from '../security/KeysCard.svelte';
	import ContactKeysCard from '../security/ContactKeysCard.svelte';
	import PrivacyCard from '../security/PrivacyCard.svelte';
	import SecurityLog from '../security/SecurityLog.svelte';
	import type { SettingsState, CeremonyKind, TwoFaSetupMethod } from '../data';

	interface Props {
		s: SettingsState;
		set: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void;
		launch: (k: CeremonyKind, opts?: { method?: TwoFaSetupMethod }) => void;
	}

	let { s, set, launch }: Props = $props();
</script>

<SecHead desc={m.settings_security_desc()} />

<SecGroup id="sec-access" title={m.settings_security_group_access()}>
	<RecoveryHero {launch} />
	<SignInCard {launch} />
	<SessionsCard />
</SecGroup>

<SecGroup id="sec-encryption" title={m.settings_security_group_encryption()}>
	<KeysCard {launch} />
	<ContactKeysCard />
</SecGroup>

<SecGroup id="sec-privacy" title={m.settings_security_group_privacy()}>
	<PrivacyCard {s} {set} />
	<SecurityLog />
</SecGroup>
