<script lang="ts">
	import { onMount } from 'svelte';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Download from '@lucide/svelte/icons/download';
	import SecHead from '../SecHead.svelte';
	import CardHead from '../CardHead.svelte';
	import Row from '../Row.svelte';
	import { Button } from '$core/components/ui/button';
	import { platform } from '$platform';
	import { appUpdate, describeUpdateProblem } from '$core/stores/appUpdate.svelte';

	onMount(() => {
		appUpdate.start();
		void appUpdate.refresh();
	});

	const status = $derived(appUpdate.status);
	const available = $derived(appUpdate.available);

	const lastChecked = $derived(
		status?.lastCheck
			? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
					new Date(status.lastCheck * 1000)
				)
			: null
	);

	const summary = $derived.by(() => {
		if (!status) return 'Checking.';
		if (appUpdate.installing) return 'Installing. Thelemail restarts when it is done.';
		if (available) {
			return appUpdate.hidden
				? `Version ${available.version} is available. You chose to be reminded later.`
				: `Version ${available.version} is available.`;
		}
		if (lastChecked) return `You have the latest version. Last checked ${lastChecked}.`;
		return 'Not checked yet.';
	});

	const blockedText = $derived(status?.blocked ? describeUpdateProblem(status.blocked) : null);
	const failureText = $derived(
		status?.lastFailure && !appUpdate.problem
			? `The last attempt did not finish. ${describeUpdateProblem(status.lastFailure)}`
			: null
	);
</script>

<SecHead desc="The version you are running and how it stays up to date." />

{#if platform.updates}
	<div class="scard">
		<CardHead title="Thelemail for Mac" />
		<Row t="Version" d={status ? status.currentVersion : ''} />
		<Row t="Updates" descSnippet={desc}>
			<div class="abt-actions">
				<Button
					variant="ghost"
					size="sm"
					onclick={() => appUpdate.check()}
					disabled={appUpdate.checking || appUpdate.installing}
				>
					<RefreshCw />Check for updates
				</Button>
				{#if available}
					<Button variant="secondary" size="sm" onclick={() => appUpdate.openRelease()}>
						<ExternalLink />Release notes
					</Button>
					{#if !status?.blocked}
						<Button
							variant="primary"
							size="sm"
							onclick={() => appUpdate.install()}
							disabled={appUpdate.installing}
						>
							<Download />Install and restart
						</Button>
					{/if}
				{/if}
			</div>
		</Row>
		<Row
			t="How updates work"
			d="Thelemail looks for a new release when it starts and every six hours. It downloads and installs one only when you choose Install. A download that is not signed with the Thelemail release key and Apple Developer ID for Thelemail is thrown away."
		/>
	</div>
{:else}
	<div class="scard">
		<CardHead title="Updates" />
		<Row
			t="Web app"
			d="This page always loads the current version of Thelemail. Updates for the desktop app are managed here in the desktop app."
		/>
	</div>
{/if}

{#snippet desc()}
	<span>{summary}</span>
	{#if appUpdate.blockers.length > 0}
		<span class="abt-note">{appUpdate.blockers.join(' ')} Finish it, then install.</span>
	{/if}
	{#if appUpdate.problem}
		<span class="abt-note">{appUpdate.problem}</span>
	{:else if failureText}
		<span class="abt-note">{failureText}</span>
	{/if}
	{#if blockedText}
		<span class="abt-note">{blockedText}</span>
	{/if}
{/snippet}

<style>
	.abt-actions {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
		justify-content: flex-end;
	}
	.abt-note {
		display: block;
		margin-top: 6px;
	}
</style>
