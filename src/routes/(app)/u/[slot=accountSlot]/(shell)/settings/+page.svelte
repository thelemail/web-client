<script lang="ts">
	import './settings.css';
	import { onMount, tick } from 'svelte';
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import Settings from '@lucide/svelte/icons/settings';
	import UserRound from '@lucide/svelte/icons/user-round';
	import AtSign from '@lucide/svelte/icons/at-sign';
	import Send from '@lucide/svelte/icons/send';
	import MailOpen from '@lucide/svelte/icons/mail-open';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import Bell from '@lucide/svelte/icons/bell';
	import Globe from '@lucide/svelte/icons/globe';
	import Globe2 from '@lucide/svelte/icons/globe-2';
	import Palette from '@lucide/svelte/icons/palette';
	import CreditCard from '@lucide/svelte/icons/credit-card';
	import Upload from '@lucide/svelte/icons/upload';
	import UserX from '@lucide/svelte/icons/user-x';
	import Check from '@lucide/svelte/icons/check';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';

	import SettingsTopBar from '$lib/settings/SettingsTopBar.svelte';
	import Profile from '$lib/settings/sections/Profile.svelte';
	import Addresses from '$lib/settings/sections/Addresses.svelte';
	import Sending from '$lib/settings/sections/Sending.svelte';
	import Reading from '$lib/settings/sections/Reading.svelte';
	import Security from '$lib/settings/sections/Security.svelte';
	import BlockedSenders from '$lib/settings/sections/BlockedSenders.svelte';
	import Region from '$lib/settings/sections/Region.svelte';
	import Appearance from '$lib/settings/sections/Appearance.svelte';
	import Account from '$lib/settings/sections/Account.svelte';
	import CustomDomains from '$lib/settings/sections/CustomDomains.svelte';
	import Import from '$lib/settings/sections/Import.svelte';
	import Ceremonies from '$lib/settings/ceremonies/Ceremonies.svelte';
	import { customDomains } from '$lib/stores/customDomains.svelte';
	import {
		SECTIONS,
		SETTINGS_DEFAULTS,
		type CeremonyKind,
		type SectionId,
		type SettingsState,
		type TwoFaSetupMethod
	} from '$lib/settings/data';
	import { preferences } from '$lib/stores/preferences.svelte';
	import { putAccountSettingsSection } from '$lib/api/accountSettings';
	import { accountSettings } from '$lib/stores/accountSettings.svelte';
	import { workspaces } from '$lib/stores/workspaces.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { twofactor } from '$lib/stores/twofactor.svelte';

	const OPEN_MESSAGE_SECTION = 'reading_open_message';
	const PRIVACY_SECTION = 'privacy';
	const LOCALIZATION_SECTION = 'localization';
	const OPEN_MESSAGE_KEYS = ['markRead', 'swipe'] as const satisfies ReadonlyArray<
		keyof SettingsState
	>;
	const PRIVACY_KEYS = ['stripTrack'] as const satisfies ReadonlyArray<keyof SettingsState>;
	const LOCALIZATION_KEYS = ['dateFmt', 'timeFmt'] as const satisfies ReadonlyArray<
		keyof SettingsState
	>;
	const APPEARANCE_KEYS = ['density'] as const satisfies ReadonlyArray<keyof SettingsState>;
	type OpenMessageKey = (typeof OPEN_MESSAGE_KEYS)[number];
	type PrivacyKey = (typeof PRIVACY_KEYS)[number];
	type LocalizationKey = (typeof LOCALIZATION_KEYS)[number];
	type AppearanceKey = (typeof APPEARANCE_KEYS)[number];

	const sectionIcons: Record<string, typeof Settings> = {
		'user-round': UserRound,
		'at-sign': AtSign,
		send: Send,
		'mail-open': MailOpen,
		'shield-check': ShieldCheck,
		bell: Bell,
		globe: Globe,
		'globe-2': Globe2,
		palette: Palette,
		'credit-card': CreditCard,
		upload: Upload,
		'user-x': UserX
	};

	let s = $state<SettingsState>({ ...SETTINGS_DEFAULTS });
	let dirtyOpenMessage = $state(false);
	let dirtyPrivacy = $state(false);
	let dirtyLocalization = $state(false);
	let dirtyAppearance = $state(false);
	let profileDirty = $state(false);
	let profileSave = $state<() => Promise<void>>(async () => {});
	let saveState = $state<'idle' | 'saving' | 'saved'>('idle');
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	let settleTimer: ReturnType<typeof setTimeout> | undefined;
	let flushing = false;
	let flushAgain = false;
	let active = $state<SectionId>('profile');
	let query = $state('');
	let toastText = $state<string | null>(null);
	let toastTimer: ReturnType<typeof setTimeout> | undefined;
	let ceremony = $state<CeremonyKind | null>(null);
	let ceremonyTwoFaMethod = $state<TwoFaSetupMethod | undefined>(undefined);

	const workspaceType = $derived(workspaces.workspace?.type ?? null);
	const workspaceName = $derived(workspaces.workspace?.name ?? '');
	const accountEmail = $derived(auth.email ?? '');
	const accountDomain = $derived(accountEmail.includes('@') ? accountEmail.split('@')[1] : '');

	function isOpenMessageKey(key: keyof SettingsState): key is OpenMessageKey {
		return (OPEN_MESSAGE_KEYS as readonly (keyof SettingsState)[]).includes(key);
	}

	function isPrivacyKey(key: keyof SettingsState): key is PrivacyKey {
		return (PRIVACY_KEYS as readonly (keyof SettingsState)[]).includes(key);
	}

	function isLocalizationKey(key: keyof SettingsState): key is LocalizationKey {
		return (LOCALIZATION_KEYS as readonly (keyof SettingsState)[]).includes(key);
	}

	function isAppearanceKey(key: keyof SettingsState): key is AppearanceKey {
		return (APPEARANCE_KEYS as readonly (keyof SettingsState)[]).includes(key);
	}

	let scrollRef: HTMLDivElement | undefined = $state();
	let spying = false;

	$effect(() => {
		preferences.density = s.density;
		preferences.highContrast = s.highContrast;
		preferences.reduceMotion = s.reduceMotion;
		preferences.textScale = s.textScale;
	});

	function set<K extends keyof SettingsState>(key: K, value: SettingsState[K]) {
		s[key] = value;
		if (isOpenMessageKey(key)) dirtyOpenMessage = true;
		if (isPrivacyKey(key)) dirtyPrivacy = true;
		if (isLocalizationKey(key)) dirtyLocalization = true;
		if (isAppearanceKey(key)) dirtyAppearance = true;
		scheduleAutosave();
	}

	function flash(text: string) {
		toastText = text;
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toastText = null), 2400);
	}

	function scheduleAutosave() {
		saveState = 'saving';
		clearTimeout(saveTimer);
		clearTimeout(settleTimer);
		saveTimer = setTimeout(() => void flushAll(), 600);
	}

	async function flushAll() {
		if (flushing) {
			flushAgain = true;
			return;
		}
		flushing = true;
		const openMessageBody = dirtyOpenMessage
			? { markRead: s.markRead, swipe: s.swipe }
			: null;
		const privacyBody = dirtyPrivacy ? { stripTrackingParams: s.stripTrack } : null;
		const localizationBody = dirtyLocalization
			? { dateFormat: s.dateFmt, timeFormat: s.timeFmt }
			: null;
		const appearanceDirty = dirtyAppearance;
		const profileNeedsSave = profileDirty;
		try {
			const tasks: Promise<unknown>[] = [];
			if (appearanceDirty) {
				tasks.push(
					accountSettings.persistAppearance({ ...accountSettings.appearance, density: s.density })
				);
			}
			if (openMessageBody) {
				tasks.push(putAccountSettingsSection(OPEN_MESSAGE_SECTION, openMessageBody));
			}
			if (privacyBody) {
				tasks.push(putAccountSettingsSection(PRIVACY_SECTION, privacyBody));
			}
			if (localizationBody) {
				tasks.push(putAccountSettingsSection(LOCALIZATION_SECTION, localizationBody));
			}
			if (profileNeedsSave) {
				tasks.push(profileSave());
			}
			await Promise.all(tasks);
			if (openMessageBody) {
				accountSettings.setReadingOpenMessage(openMessageBody);
				dirtyOpenMessage = false;
			}
			if (privacyBody) {
				accountSettings.setPrivacy({ stripTrackingParams: privacyBody.stripTrackingParams });
				dirtyPrivacy = false;
			}
			if (localizationBody) {
				accountSettings.setLocalization(localizationBody);
				dirtyLocalization = false;
			}
			if (appearanceDirty) {
				dirtyAppearance = false;
			}
			if (!flushAgain) {
				saveState = 'saved';
				clearTimeout(settleTimer);
				settleTimer = setTimeout(() => {
					if (saveState === 'saved') saveState = 'idle';
				}, 2200);
			}
		} catch (err) {
			saveState = 'idle';
			flash(err instanceof Error ? err.message : 'Could not save — try again');
		} finally {
			flushing = false;
			if (flushAgain) {
				flushAgain = false;
				scheduleAutosave();
			}
		}
	}

	const ceremonyMessages: Record<CeremonyKind, string> = {
		recovery: 'Recovery set up',
		password: 'Password changed',
		twofa: 'Two-factor updated',
		keys: 'Key rotated',
		delete: 'Account scheduled for deletion',
		domain: 'Domain added',
		address: 'Address added',
		member: ''
	};

	async function completeCeremony(kind: CeremonyKind) {
		if (kind === 'recovery') void auth.loadProfile();
		if (kind === 'twofa') {
			twofactor.invalidate();
			void twofactor.load();
		}
		if (kind === 'domain') {
			void customDomains.load(workspaces.workspace?.id ?? null);
		}
		let msg = ceremonyMessages[kind];
		if (kind === 'member') {
			msg = workspaceType === 'business' ? 'Member added · seat created' : 'Invitation sent';
			workspaces.loadActiveDetails(auth.accountId);
		}
		flash(msg || 'Done');
	}

	function handleScroll() {
		if (spying || !scrollRef) return;
		const top = scrollRef.scrollTop + 130;
		let cur: SectionId = SECTIONS[0].id;
		for (const sec of SECTIONS) {
			const node = document.getElementById('sec-' + sec.id);
			if (node && node.offsetTop <= top) cur = sec.id;
		}
		active = cur;
	}

	async function gotoSection(id: SectionId) {
		active = id;
		await tick();
		const node = document.getElementById('sec-' + id);
		if (node && scrollRef) {
			spying = true;
			scrollRef.scrollTo({ top: node.offsetTop - 28, behavior: 'smooth' });
			setTimeout(() => {
				spying = false;
			}, 460);
		}
	}

	function isSectionId(s: string): s is SectionId {
		return SECTIONS.some((sec) => sec.id === s);
	}

	$effect(() => {
		const h = page.url.hash.slice(1);
		if (h && isSectionId(h)) void gotoSection(h);
	});

	$effect(() => {
		if (page.url.searchParams.get('ceremony') === 'recovery') {
			ceremony = 'recovery';
			replaceState(page.url.pathname + page.url.hash, {});
		}
	});

	onMount(async () => {
		handleScroll();
		await accountSettings.hydrate();
		const v = accountSettings.readingOpenMessage;
		s.markRead = v.markRead;
		s.swipe = v.swipe;
		const p = accountSettings.privacy;
		s.stripTrack = p.stripTrackingParams;
		const loc = accountSettings.localization;
		s.dateFmt = loc.dateFormat;
		s.timeFmt = loc.timeFormat;
		s.density = accountSettings.appearance.density;
	});

	function pad2(n: number): string {
		return String(n).padStart(2, '0');
	}

	function launchCeremony(k: CeremonyKind, opts?: { method?: TwoFaSetupMethod }) {
		ceremonyTwoFaMethod = opts?.method;
		ceremony = k;
	}
</script>

<svelte:head>
	<title>Thelemail — Settings</title>
</svelte:head>

<SettingsTopBar {query} setQuery={(q) => (query = q)} />

<div class="mailbody settings-body">
	<nav class="set-nav">
		<div class="nav-eyebrow">Settings</div>
		{#each SECTIONS as sec, i (sec.id)}
			{@const Icon = sectionIcons[sec.icon] ?? UserRound}
			<button
				type="button"
				class="snav"
				class:active={active === sec.id}
				onclick={() => gotoSection(sec.id)}
			>
				<span class="snav-no">{pad2(i + 1)}</span>
				<Icon size={17} /><span class="lbl">{sec.label}</span>
			</button>
		{/each}
		<div class="nav-foot">
			Signed in as <b>{accountEmail}</b><br />{workspaceName} · {accountDomain}
		</div>
	</nav>

	<div class="set-col">
		<header class="set-head">
			<div class="ht">
				<h1>Settings</h1>
				<div class="sub">
					<span>Personal preferences for</span>
					<span class="mono">{accountEmail}</span>
					<span class="sub-dot"></span>
					<span>only affects your mailbox</span>
				</div>
			</div>
			<div class="save-wrap">
				<div class="autosave {saveState}" aria-live="polite">
					{#if saveState === 'saving'}
						<span class="as-spin"></span><span class="as-tx">Saving…</span>
					{:else if saveState === 'saved'}
						<Check size={14} /><span class="as-tx">Saved</span>
					{:else}
						<RefreshCw size={13} /><span class="as-tx">Changes save automatically</span>
					{/if}
				</div>
			</div>
		</header>

		<div
			class="set-scroll"
			bind:this={scrollRef}
			onscroll={handleScroll}
			style:--tscale={s.textScale / 100}
		>
			<div class="set-content">
				<div class="sec" id="sec-profile">
					<Profile
						email={accountEmail}
						bind:dirty={profileDirty}
						bind:save={profileSave}
						onEdit={scheduleAutosave}
					/>
				</div>
				<div class="sec" id="sec-addresses">
					<Addresses {s} {set} launch={launchCeremony} />
				</div>
				<div class="sec" id="sec-domains">
					<CustomDomains launch={launchCeremony} />
				</div>
				<div class="sec" id="sec-sending">
					<Sending {s} {set} />
				</div>
				<div class="sec" id="sec-reading">
					<Reading {s} {set} />
				</div>
				<div class="sec" id="sec-security">
					<Security {s} {set} launch={launchCeremony} />
				</div>
				<div class="sec" id="sec-blocked">
					<BlockedSenders />
				</div>
				<div class="sec" id="sec-import">
					<Import />
				</div>
				<div class="sec" id="sec-region">
					<Region {s} {set} />
				</div>
				<div class="sec" id="sec-appearance">
					<Appearance {s} {set} />
				</div>
				<div class="sec" id="sec-account">
					<Account launch={launchCeremony} />
				</div>
			</div>
		</div>
	</div>
</div>

{#if toastText}
	<div class="mail-toast settings-toast"><CircleCheck size={16} />{toastText}</div>
{/if}

<Ceremonies
	active={ceremony}
	twoFaMethod={ceremonyTwoFaMethod}
	onClose={() => (ceremony = null)}
	onComplete={completeCeremony}
/>
