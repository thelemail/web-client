<script lang="ts">
	import { onMount } from 'svelte';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import SecHead from '../SecHead.svelte';
	import CardHead from '../CardHead.svelte';
	import Row from '../Row.svelte';
	import Select from '../Select.svelte';
	import type { SettingsState } from '../data';
	import type { NotificationStatus } from '$core/platform/types';
	import { platform } from '$platform';
	import { accountSettings } from '$lib/stores/accountSettings.svelte';
	import { Button } from '$lib/components/ui/button';
	import {
		reminderPermission,
		requestReminderPermission,
		type ReminderPermission
	} from '$lib/calendar/reminders';

	interface Props {
		s: SettingsState;
		set: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void;
	}

	let { s, set }: Props = $props();

	const SYSTEM_SETTINGS_URL = 'x-apple.systempreferences:com.apple.Notifications-Settings.extension';

	const REMINDER_CHOICES: [number | null, string][] = [
		[null, 'No reminder'],
		[0, 'At the time'],
		[5, '5 minutes before'],
		[10, '10 minutes before'],
		[15, '15 minutes before'],
		[30, '30 minutes before'],
		[60, '1 hour before'],
		[120, '2 hours before'],
		[1440, '1 day before']
	];

	const reminderLabels = REMINDER_CHOICES.map(([, label]) => label);

	const reminderDefault = $derived(
		REMINDER_CHOICES.find(([m]) => m === accountSettings.calendar.defaultReminderMinutes)?.[1] ??
			REMINDER_CHOICES[0][1]
	);

	function setReminderDefault(label: string) {
		const choice = REMINDER_CHOICES.find(([, l]) => l === label);
		if (!choice) return;
		void accountSettings
			.persistCalendar({ ...accountSettings.calendar, defaultReminderMinutes: choice[0] })
			.catch(() => {});
	}

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

	let reminders = $state<ReminderPermission>('default');

	onMount(() => {
		reminders = reminderPermission();
	});

	async function enableReminders() {
		reminders = await requestReminderPermission();
	}

	const reminderSummary = $derived.by(() => {
		switch (reminders) {
			case 'granted':
				return 'Allowed. Reminders you set on events fire as browser notifications while a Thelemail tab is open, and as an in-app notice otherwise.';
			case 'denied':
				return 'Blocked for this site in the browser. Reminders still show inside the calendar while it is open.';
			case 'unsupported':
				return 'This browser does not offer notifications. Reminders show inside the calendar while it is open.';
			default:
				return 'Not asked yet. Reminders show inside the calendar until you allow browser notifications.';
		}
	});

	const canOpenSystemSettings = $derived(
		!!status && status.bundled && !status.translocated && status.authorization !== 'unbundled'
	);
</script>

<SecHead desc="What reaches you while the app is in the background." />

{#if platform.notifications}
	<div class="scard">
		<CardHead title="New mail" />
		<Row t="macOS notifications" descSnippet={desc}>
			<div class="ntf-actions">
				<Button variant="ghost" size="sm" onclick={check} disabled={checking}>
					<RefreshCw />Check again
				</Button>
				{#if canOpenSystemSettings}
					<Button variant="secondary" size="sm" onclick={() => platform.openExternal(SYSTEM_SETTINGS_URL)}>
						<ExternalLink />Open System Settings
					</Button>
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

<div class="scard">
	<CardHead title="Calendar reminders" />
	<Row t="Reminders in this browser" d={reminderSummary}>
		{#if reminders === 'default'}
			<Button variant="secondary" size="sm" onclick={enableReminders}>Allow reminders</Button>
		{/if}
	</Row>
	<Row
		t="Remind me by default"
		d="Applied to new events and to invitations that arrive without a reminder of their own."
	>
		<Select
			value={reminderDefault}
			options={reminderLabels}
			onChange={setReminderDefault}
			ariaLabel="Default reminder"
		/>
	</Row>
</div>

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
