<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
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
	import { page } from '$app/state';
	import { SECTIONS } from './data';
	import { workspaces } from '$lib/stores/workspaces.svelte';
	import { auth } from '$lib/stores/auth.svelte';

	const icons: Record<string, typeof Settings> = {
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

	const slot = $derived(page.params.slot ?? '0');
	const current = $derived.by(() => {
		const parts = page.url.pathname.split('/').filter(Boolean);
		const i = parts.indexOf('settings');
		return (i === -1 ? parts.at(-1) : parts[i + 1]) ?? '';
	});
	const accountEmail = $derived(auth.email ?? '');
	const accountDomain = $derived(accountEmail.includes('@') ? accountEmail.split('@')[1] : '');
	const workspaceName = $derived(workspaces.workspace?.name ?? '');
</script>

<nav class="set-nav">
	<a class="set-back" href={`/u/${slot}/mail/inbox`}>
		<ArrowLeft size={16} /><span class="lbl">Back to inbox</span>
	</a>
	<div class="nav-eyebrow">Settings</div>
	{#each SECTIONS as sec (sec.id)}
		{@const Icon = icons[sec.icon] ?? UserRound}
		<a
			class="snav"
			class:active={current === sec.id}
			href={`/u/${slot}/settings/${sec.id}`}
			aria-current={current === sec.id ? 'page' : undefined}
		>
			<Icon size={17} /><span class="lbl">{sec.label}</span>
		</a>
	{/each}
	<div class="nav-foot">
		Signed in as <b>{accountEmail}</b><br />{workspaceName} · {accountDomain}
	</div>
</nav>
