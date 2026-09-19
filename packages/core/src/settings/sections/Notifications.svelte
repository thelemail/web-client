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
	import { accountSettings } from '$core/stores/accountSettings.svelte';
	import { Button } from '$core/components/ui/button';
	import {
		reminderPermission,
		requestReminderPermission,
		type ReminderPermission
	} from '$core/calendar/reminders';
	import { m } from '$paraglide/messages.js';

	interface Props {
		s: SettingsState;
		set: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void;
	}

	let { s, set }: Props = $props();

	const SYSTEM_SETTINGS_URL = 'x-apple.systempreferences:com.apple.Notifications-Settings.extension';

	const REMINDER_CHOICES: (number | null)[] = [null, 0, 5, 10, 15, 30, 60, 120, 1440];

	function reminderLabel(minutes: number | null): string {
		if (minutes === null) return m.settings_notify_reminder_none();
		if (minutes === 0) return m.settings_notify_reminder_at_time();
		if (minutes % 1440 === 0) return m.settings_notify_reminder_days({ count: minutes / 1440 });
		if (minutes % 60 === 0) return m.settings_notify_reminder_hours({ count: minutes / 60 });
		return m.settings_notify_reminder_minutes({ count: minutes });
	}

	const reminderKey = (minutes: number | null) => (minutes === null ? 'none' : String(minutes));

	const reminderOptions = $derived(
		REMINDER_CHOICES.map((minutes) => ({ v: reminderKey(minutes), l: reminderLabel(minutes) }))
	);

	const reminderDefault = $derived(
		reminderKey(
			REMINDER_CHOICES.find((minutes) => minutes === accountSettings.calendar.defaultReminderMinutes) ??
				REMINDER_CHOICES[0]
		)
	);

	function setReminderDefault(key: string) {
		const choice = REMINDER_CHOICES.find((minutes) => reminderKey(minutes) === key);
		if (choice === undefined) return;
		void accountSettings
			.persistCalendar({ ...accountSettings.calendar, defaultReminderMinutes: choice })
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
		if (!status) return m.settings_notify_checking();
		if (!status.supported) return m.settings_notify_unsupported();
		if (!status.bundled) return m.settings_notify_unbundled();
		if (status.translocated) {
			return m.settings_notify_translocated();
		}
		switch (status.authorization) {
			case 'authorized':
			case 'provisional':
			case 'ephemeral':
				return m.settings_notify_authorized();
			case 'denied':
				return m.settings_notify_denied();
			case 'notDetermined':
				return m.settings_notify_not_determined();
			default:
				return m.settings_notify_unknown();
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
				return m.settings_notify_reminders_granted();
			case 'denied':
				return m.settings_notify_reminders_denied();
			case 'unsupported':
				return m.settings_notify_reminders_unsupported();
			default:
				return m.settings_notify_reminders_default();
		}
	});

	const canOpenSystemSettings = $derived(
		!!status && status.bundled && !status.translocated && status.authorization !== 'unbundled'
	);
</script>

<SecHead desc={m.settings_notify_desc()} />

{#if platform.notifications}
	<div class="scard">
		<CardHead title={m.settings_notify_new_mail()} />
		<Row t={m.settings_notify_macos()} descSnippet={desc}>
			<div class="ntf-actions">
				<Button variant="ghost" size="sm" onclick={check} disabled={checking}>
					<RefreshCw />{m.settings_notify_check_again()}
				</Button>
				{#if canOpenSystemSettings}
					<Button variant="secondary" size="sm" onclick={() => platform.openExternal(SYSTEM_SETTINGS_URL)}>
						<ExternalLink />{m.settings_notify_open_system_settings()}
					</Button>
				{/if}
			</div>
		</Row>
	</div>
{:else}
	<div class="scard">
		<CardHead title={m.settings_notify_new_mail()} />
		<Row
			t={m.settings_notify_desktop()}
			d={m.settings_notify_desktop_desc()}
		/>
	</div>
{/if}

<div class="scard">
	<CardHead title={m.settings_notify_reminders_title()} />
	<Row t={m.settings_notify_reminders_browser()} d={reminderSummary}>
		{#if reminders === 'default'}
			<Button variant="secondary" size="sm" onclick={enableReminders}>{m.settings_notify_reminders_allow()}</Button>
		{/if}
	</Row>
	<Row
		t={m.settings_notify_reminder_default()}
		d={m.settings_notify_reminder_default_desc()}
	>
		<Select
			value={reminderDefault}
			options={reminderOptions}
			onChange={setReminderDefault}
			ariaLabel={m.settings_notify_reminder_default_aria()}
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
