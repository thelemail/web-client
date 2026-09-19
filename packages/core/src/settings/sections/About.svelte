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
	import { m } from '$paraglide/messages.js';

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
		if (!status) return m.settings_about_checking();
		if (appUpdate.installing) return m.settings_about_installing();
		if (available) {
			return appUpdate.hidden
				? m.settings_about_available_later({ version: available.version })
				: m.settings_about_available({ version: available.version });
		}
		if (lastChecked) return m.settings_about_latest({ lastChecked });
		return m.settings_about_not_checked();
	});

	const blockedText = $derived(status?.blocked ? describeUpdateProblem(status.blocked) : null);
	const failureText = $derived(
		status?.lastFailure && !appUpdate.problem
			? m.settings_about_last_failure({ problem: describeUpdateProblem(status.lastFailure) })
			: null
	);
</script>

<SecHead desc={m.settings_about_desc()} />

{#if platform.updates}
	<div class="scard">
		<CardHead title={m.settings_about_mac_title()} />
		<Row t={m.settings_about_version()} d={status ? status.currentVersion : ''} />
		<Row t={m.settings_about_updates()} descSnippet={desc}>
			<div class="abt-actions">
				<Button
					variant="ghost"
					size="sm"
					onclick={() => appUpdate.check()}
					disabled={appUpdate.checking || appUpdate.installing}
				>
					<RefreshCw />{m.settings_about_check()}
				</Button>
				{#if available}
					<Button variant="secondary" size="sm" onclick={() => appUpdate.openRelease()}>
						<ExternalLink />{m.settings_about_release_notes()}
					</Button>
					{#if !status?.blocked}
						<Button
							variant="primary"
							size="sm"
							onclick={() => appUpdate.install()}
							disabled={appUpdate.installing}
						>
							<Download />{m.settings_about_install()}
						</Button>
					{/if}
				{/if}
			</div>
		</Row>
		<Row
			t={m.settings_about_how_title()}
			d={m.settings_about_how_desc()}
		/>
	</div>
{:else}
	<div class="scard">
		<CardHead title={m.settings_about_updates()} />
		<Row
			t={m.settings_about_web_title()}
			d={m.settings_about_web_desc()}
		/>
	</div>
{/if}

{#snippet desc()}
	<span>{summary}</span>
	{#if appUpdate.blockers.length > 0}
		<span class="abt-note">{m.settings_about_blockers({ blockers: appUpdate.blockers.join(' ') })}</span>
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
