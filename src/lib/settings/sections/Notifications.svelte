<script lang="ts">
	import { onMount } from 'svelte';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import SecHead from '../SecHead.svelte';
	import CardHead from '../CardHead.svelte';
	import Row from '../Row.svelte';
	import type { SettingsState } from '../data';
	import type { NotificationStatus } from '$lib/platform/types';
	import { platform } from '$platform';

	interface Props {
		s: SettingsState;
		set: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void;
	}

	let { s, set }: Props = $props();

	const SYSTEM_SETTINGS_URL = 'x-apple.systempreferences:com.apple.Notifications-Settings.extension';

	let status = $state<NotificationStatus | null>(null);
	let checking = $state(false);

	async function check() {
		const native = platform.notifications;
		if (!native) return;
		checking = true;
		try {
			status = await native.status();
		} catch {
			status = null;
		} finally {
			checking = false;
		}
	}

	onMount(() => {
		const native = platform.notifications;
		if (!native) return;
		void check();
		return native.onStatus((next) => (status = next));
	});

	const summary = $derived.by(() => {
		if (!status) return 'Checking with macOS.';
		if (!status.supported) return 'Not available on this platform.';
		if (!status.bundled) return 'Not available in development builds.';
		if (status.translocated) {
			return 'macOS is running Thelemail from a temporary location, so it cannot register for notifications. Move the app to the Applications folder and open it from there.';
		}
		switch (status.authorization) {
			case 'authorized':
			case 'provisional':
			case 'ephemeral':
				return 'Allowed. New mail shows a banner and plays a sound while Thelemail is running.';
			case 'denied':
				return 'Turned off for Thelemail in System Settings.';
			case 'notDetermined':
				return 'macOS has not asked for permission yet. The prompt appears the next time a message arrives.';
			default:
				return 'macOS did not report a state.';
		}
	});

	const canOpenSystemSettings = $derived(
		!!status && status.bundled && !status.translocated && status.authorization !== 'unbundled'
	);
</script>

<SecHead
	title="Notifications"
	desc="What reaches you while the app is in the background."
/>

{#if platform.notifications}
	<div class="scard">
		<CardHead title="New mail" />
		<Row t="macOS notifications" descSnippet={desc}>
			<div class="ntf-actions">
				<button type="button" class="btn btn-ghost btn-sm" onclick={check} disabled={checking}>
					<RefreshCw />Check again
				</button>
				{#if canOpenSystemSettings}
					<button
						type="button"
						class="btn btn-secondary btn-sm"
						onclick={() => platform.openExternal(SYSTEM_SETTINGS_URL)}
					>
						<ExternalLink />Open System Settings
					</button>
				{/if}
			</div>
		</Row>
	</div>
{:else}
	<div class="scard">
		<CardHead title="New mail" />
		<Row
			t="Desktop notifications"
			d="Available in the Thelemail desktop app, which watches for new mail while it runs in the background."
		/>
	</div>
{/if}

{#snippet desc()}
	<span>{summary}</span>
	{#if status?.lastError}
		<span class="ntf-err"><code>{status.lastError}</code></span>
	{/if}
{/snippet}

<style>
	.ntf-actions {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
		justify-content: flex-end;
	}
	.ntf-err {
		display: block;
		margin-top: 6px;
	}
</style>
