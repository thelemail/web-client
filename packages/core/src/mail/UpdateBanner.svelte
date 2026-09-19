<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import { onMount } from 'svelte';
	import Download from '@lucide/svelte/icons/download';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import { appUpdate } from '$core/stores/appUpdate.svelte';

	onMount(() => appUpdate.start());

	const progressText = $derived.by(() => {
		const p = appUpdate.progress;
		if (!p) return m.mail_update_progress_starting();
		if (p.phase === 'verify') return m.mail_update_progress_verify();
		if (p.phase === 'restart') return m.mail_update_progress_restart();
		if (p.total) return m.mail_update_progress_percent({ percent: Math.floor((p.downloaded / p.total) * 100) });
		return m.mail_update_progress_downloading();
	});

	const detail = $derived.by(() => {
		if (appUpdate.installing) return progressText;
		if (appUpdate.blockers.length > 0) {
			return m.mail_update_blocked({ blockers: appUpdate.blockers.join(' ') });
		}
		if (appUpdate.problem) return appUpdate.problem;
		return m.mail_update_detail();
	});
</script>

{#if appUpdate.bannerVisible && appUpdate.available}
	<div class="sysalerts" role="status" aria-label={m.mail_update_aria()}>
		<div class="sysalert" class:sa-info={!appUpdate.problem} class:sa-warning={!!appUpdate.problem}>
			<span class="sa-ic"><Download size={15} /></span>
			<span class="sa-tx">
				<span class="sa-h">{m.mail_update_available({ version: appUpdate.available.version })}</span>
				<span class="sa-d">{detail}</span>
			</span>
			{#if !appUpdate.installing}
				<span class="sa-acts">
					<button class="sa-act ghost" onclick={() => appUpdate.openRelease()}>
						<ExternalLink size={13} />{m.mail_update_release_notes()}
					</button>
					<button class="sa-act ghost" onclick={() => appUpdate.later()}>{m.mail_update_later()}</button>
					<button class="sa-act solid" onclick={() => appUpdate.install()}>
						{m.mail_update_install()}
					</button>
				</span>
			{/if}
		</div>
	</div>
{/if}
