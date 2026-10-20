<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import LifeBuoy from '@lucide/svelte/icons/life-buoy';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { Button } from '$core/components/ui/button';
	import Rich from '$core/i18n/Rich.svelte';
	import { auth } from '$core/stores/auth.svelte';
	import type { CeremonyKind } from '../data';

	interface Props {
		launch: (k: CeremonyKind) => void;
	}

	let { launch }: Props = $props();

	const recoverySet = $derived(auth.recoveryEnabled === true);
</script>

{#snippet bold(t: string)}<b>{t}</b>{/snippet}

<div class="recovery-hero" class:done={recoverySet}>
	<div class="rh-left">
		<span class="rh-ic">
			{#if recoverySet}<ShieldCheckIcon size={26} />{:else}<LifeBuoy size={26} />{/if}
		</span>
	</div>
	<div class="rh-body">
		<div class="rh-eyebrow">
			{recoverySet ? m.settings_security_recovery_configured() : m.settings_security_recovery_recommended()}
		</div>
		<h3 class="rh-title">{m.settings_security_recovery_title()}</h3>
		<p class="rh-desc">
			<Rich
				text={recoverySet ? m.settings_security_recovery_desc_set() : m.settings_security_recovery_desc_unset()}
				tags={{ b: bold }}
			/>
		</p>
		<div class="rh-acts">
			<Button variant="primary" onclick={() => launch('recovery')}>
				{#if recoverySet}<RefreshCw size={15} />{:else}<KeyRound size={15} />{/if}
				{recoverySet ? m.settings_security_recovery_regenerate() : m.settings_security_recovery_setup()}
			</Button>
		</div>
	</div>
	{#if !recoverySet}
		<span class="rh-flag"><TriangleAlert size={13} />{m.settings_security_recovery_not_set()}</span>
	{/if}
</div>
