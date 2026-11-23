<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import Icon from '$core/components/Icon.svelte';
	import {
		faArrowsRotate,
		faCircleExclamation,
		faKey,
		faLifeRing,
		faShieldCheck,
		faTriangleExclamation
	} from '@fortawesome/pro-regular-svg-icons';
	import { Button } from '$core/components/ui/button';
	import Rich from '$core/i18n/Rich.svelte';
	import Card from '../Card.svelte';
	import Heading from '../Heading.svelte';
	import CeremonyRow from '../CeremonyRow.svelte';
	import { auth } from '$core/stores/session.svelte';
	import type { CeremonyKind } from '../data';

	interface Props {
		launch: (k: CeremonyKind) => void;
	}

	let { launch }: Props = $props();

	let retrying = $state(false);

	async function retry() {
		retrying = true;
		try {
			await auth.loadProfile();
		} finally {
			retrying = false;
		}
	}
</script>

{#snippet bold(t: string)}<b>{t}</b>{/snippet}

{#if auth.recoveryState === 'unset'}
	<div class="recovery-hero">
		<div class="rh-left">
			<span class="rh-ic"><Icon icon={faLifeRing} size={26} /></span>
		</div>
		<div class="rh-body">
			<div class="rh-eyebrow">{m.settings_security_recovery_recommended()}</div>
			<Heading class="rh-title">{m.settings_security_recovery_title()}</Heading>
			<p class="rh-desc">
				<Rich text={m.settings_security_recovery_desc_unset()} tags={{ b: bold }} />
			</p>
			<div class="rh-acts">
				<Button variant="primary" onclick={() => launch('recovery')}>
					<Icon icon={faKey} size={15} />{m.settings_security_recovery_setup()}
				</Button>
			</div>
		</div>
		<span class="rh-flag"><Icon icon={faTriangleExclamation} size={13} />{m.settings_security_recovery_not_set()}</span>
	</div>
{:else if auth.recoveryState === 'set'}
	<Card>
		<CeremonyRow
			icon={faShieldCheck}
			title={m.settings_security_recovery_title()}
			status={m.settings_security_on()}
			statusKind="ok"
			desc={m.settings_security_recovery_desc_set()}
			cta={m.settings_security_recovery_regenerate()}
			onLaunch={() => launch('recovery')}
		/>
	</Card>
{:else if auth.recoveryState === 'error'}
	<Card>
		<div class="setrow set-loaderr" role="alert">
			<Icon icon={faCircleExclamation} size={16} />
			<p>{m.settings_security_recovery_load_failed()}</p>
			<Button variant="secondary" size="sm" disabled={retrying} onclick={retry}>
				<Icon icon={faArrowsRotate} />{m.common_retry()}
			</Button>
		</div>
	</Card>
{:else}
	<Card class="set-skel" aria-busy="true">
		<span class="sr-only">{m.settings_security_recovery_checking()}</span>
		<div class="setrow" aria-hidden="true">
			<div class="info">
				<span class="sk-bar sk-t"></span>
				<span class="sk-bar sk-d"></span>
			</div>
		</div>
	</Card>
{/if}
