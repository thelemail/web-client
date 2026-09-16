<script lang="ts">
	import { onMount } from 'svelte';
	import Download from '@lucide/svelte/icons/download';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import { appUpdate } from '$core/stores/appUpdate.svelte';

	onMount(() => appUpdate.start());

	const progressText = $derived.by(() => {
		const p = appUpdate.progress;
		if (!p) return 'Starting the download.';
		if (p.phase === 'verify') return 'Checking the signature.';
		if (p.phase === 'restart') return 'Restarting.';
		if (p.total) return `Downloading, ${Math.floor((p.downloaded / p.total) * 100)}%.`;
		return 'Downloading.';
	});

	const detail = $derived.by(() => {
		if (appUpdate.installing) return progressText;
		if (appUpdate.blockers.length > 0) {
			return `${appUpdate.blockers.join(' ')} Finish it, then install.`;
		}
		if (appUpdate.problem) return appUpdate.problem;
		return 'Installing restarts the app. Nothing happens until you choose to install.';
	});
</script>

{#if appUpdate.bannerVisible && appUpdate.available}
	<div class="sysalerts" role="status" aria-label="App update">
		<div class="sysalert" class:sa-info={!appUpdate.problem} class:sa-warning={!!appUpdate.problem}>
			<span class="sa-ic"><Download size={15} /></span>
			<span class="sa-tx">
				<span class="sa-h">Thelemail {appUpdate.available.version} is available.</span>
				<span class="sa-d">{detail}</span>
			</span>
			{#if !appUpdate.installing}
				<span class="sa-acts">
					<button class="sa-act ghost" onclick={() => appUpdate.openRelease()}>
						<ExternalLink size={13} />Release notes
					</button>
					<button class="sa-act ghost" onclick={() => appUpdate.later()}>Later</button>
					<button class="sa-act solid" onclick={() => appUpdate.install()}>
						Install and restart
					</button>
				</span>
			{/if}
		</div>
	</div>
{/if}
