<script lang="ts">
	import CalendarPlus from '@lucide/svelte/icons/calendar-plus';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Users from '@lucide/svelte/icons/users';
	import { lookupDirectory } from '$core/directory/lookup';
	import {
		createCalendar,
		rotateCalendarMembers,
		updateCalendar,
		type CalendarMemberGrant,
		type CalendarRole
	} from '$core/api/calendars';
	import { Button } from '$core/components/ui/button';
	import { Checkbox } from '$core/components/ui/checkbox';
	import * as Dialog from '$core/components/ui/dialog';
	import { verifyDirectoryLookup } from '$core/directory/verify';
	import { hexToB64, textToB64 } from '$core/keys/encode';
	import { keystore } from '$core/keystore/keystore-client';
	import { senderKey } from '$core/mail/send';
	import { bytesToB64 } from '$core/crypto';
	import { addresses } from '$core/stores/addresses.svelte';
	import { auth } from '$core/stores/auth.svelte';
	import { calendarKeys } from '$core/stores/calendarKeys.svelte';
	import { workspaces } from '$core/stores/workspaces.svelte';
	import { m } from '$paraglide/messages.js';
	import DisclosureBoundary from '../DisclosureBoundary.svelte';
	import { META_SCHEMA_VERSION, serializeMeta, type CalendarMeta, type Privacy } from '../model';
	import { mintOwnCalendarKey, sealText, type SealKey } from '../seal';
	import { cal } from '../state.svelte';
	import { calendarStore } from '../store.svelte';
	import type { BoundaryLine, CalendarDialogRequest } from '../types';

	interface Props {
		request: CalendarDialogRequest;
	}

	let { request }: Props = $props();

	const PALETTE = ['#2E5440', '#A87C3D', '#3C6E8C', '#9B5B4E', '#6E5B9E', '#4E8073', '#6B7360', '#7E6BA8'];

	const existing = $derived(request.calendarId ? calendarStore.calendar(request.calendarId) : undefined);

	let kind = $state<'personal' | 'shared' | 'role'>('personal');
	let name = $state('');
	let color = $state(PALETTE[0]);
	let description = $state('');
	let defaultPrivacy = $state<Privacy>('busy');
	let aliasAddressId = $state('');
	let roles = $state<Record<string, CalendarRole | null>>({});
	let busy = $state(false);
	let progress = $state('');
	let error = $state<string | null>(null);
	let initialised = false;

	$effect(() => {
		if (initialised) return;
		initialised = true;
		if (existing) {
			kind = existing.kind;
			name = existing.meta?.name ?? '';
			color = existing.meta?.color ?? PALETTE[0];
			description = existing.meta?.description ?? '';
			defaultPrivacy = existing.meta?.defaultPrivacy ?? 'busy';
			const next: Record<string, CalendarRole | null> = {};
			for (const member of existing.row.members) next[member.accountId] = member.role;
			roles = next;
		} else if (auth.accountId) {
			roles = { [auth.accountId]: 'owner' };
		}
	});

	const members = $derived(workspaces.members);
	const canShare = $derived(members.length > 1);
	const sharedAddresses = $derived(addresses.shared);
	const isAdmin = $derived(workspaces.canManage(auth.accountId));

	const title = $derived(
		request.mode === 'create'
			? m.cal_caldlg_title_create()
			: request.mode === 'share'
				? m.cal_caldlg_title_share()
				: request.mode === 'delete'
					? m.cal_caldlg_title_delete()
					: m.cal_caldlg_title_edit()
	);

	const boundary = $derived.by((): BoundaryLine[] => {
		if (kind === 'personal') {
			return [
				{ tone: 'yes', text: m.cal_caldlg_personal_sealed() },
				{ tone: 'no', text: m.cal_caldlg_personal_server() }
			];
		}
		if (kind === 'role') {
			return [
				{ tone: 'yes', text: m.cal_caldlg_role_sealed() },
				{ tone: 'warn', text: m.cal_caldlg_role_warn() }
			];
		}
		const count = Object.values(roles).filter(Boolean).length;
		return [
			{ tone: 'yes', text: m.cal_caldlg_shared_key({ count }) },
			{ tone: 'warn', text: m.cal_caldlg_shared_server() }
		];
	});

	function toggle(accountId: string) {
		if (accountId === auth.accountId && request.mode === 'create') return;
		roles = { ...roles, [accountId]: roles[accountId] ? null : 'editor' };
	}

	function setRole(accountId: string, role: CalendarRole) {
		roles = { ...roles, [accountId]: role };
	}

	function meta(): CalendarMeta {
		return { schemaVersion: META_SCHEMA_VERSION, name: name.trim(), color, description: description.trim() || undefined, defaultPrivacy };
	}

	async function resolveRecipients(): Promise<{ accountId: string; publicKeyArmored: string; role: CalendarRole }[]> {
		const out = [];
		for (const member of members) {
			const role = roles[member.accountId];
			if (!role) continue;
			progress = m.cal_caldlg_verifying({ email: member.email });
			const lookup = await lookupDirectory(member.email);
			await verifyDirectoryLookup(lookup, member.email.trim().toLowerCase());
			out.push({ accountId: member.accountId, publicKeyArmored: lookup.publicKeyArmored, role });
		}
		if (!out.length) throw new Error(m.cal_caldlg_pick_member());
		if (!out.some((r) => r.role === 'owner')) throw new Error(m.cal_caldlg_needs_owner());
		return out;
	}

	async function mintKey(accountId: string) {
		const recipients = await resolveRecipients();
		progress = m.cal_caldlg_creating_key();
		const created = await keystore.createAliasKey({
			accountId,
			email: '',
			displayName: 'Thelemail calendar',
			recipients: recipients.map((r) => ({ accountId: r.accountId, publicKeyArmored: r.publicKeyArmored }))
		});
		if (!created.ok) {
			throw new Error(created.code === 'locked' ? m.cal_caldlg_unlock() : m.cal_caldlg_key_failed());
		}
		const grants: CalendarMemberGrant[] = created.grants.map((g) => ({
			accountId: g.accountId,
			role: recipients.find((r) => r.accountId === g.accountId)?.role ?? 'editor',
			memberKeyFingerprint: hexToB64(g.memberKeyFingerprintHex),
			wrappedPrivateKey: textToB64(g.wrappedPrivateKeyArmored)
		}));
		const key: SealKey = {
			publicKeyArmored: created.publicKeyArmored,
			fingerprintB64: hexToB64(created.keyFingerprintHex),
			fingerprintHex: created.keyFingerprintHex
		};
		return { grants, key };
	}

	async function mintOwnKey(accountId: string) {
		progress = m.cal_caldlg_creating_key();
		return mintOwnCalendarKey(accountId);
	}

	async function aliasKey(accountId: string, aliasId: string): Promise<SealKey> {
		const res = await keystore.getPublicKey({ accountId, aliasId });
		if (!res.ok) throw new Error(m.cal_caldlg_alias_key_missing());
		return { publicKeyArmored: res.publicKeyArmored, fingerprintB64: bytesToB64(res.fingerprint), fingerprintHex: '' };
	}

	async function submitCreate(accountId: string) {
		if (!name.trim()) throw new Error(m.cal_caldlg_name_required());
		let key: SealKey;
		let grants: CalendarMemberGrant[] | undefined;
		let sharedAliasId: string | undefined;
		if (kind === 'shared') {
			const minted = await mintKey(accountId);
			key = minted.key;
			grants = minted.grants;
		} else if (kind === 'role') {
			const addr = sharedAddresses.find((a) => a.id === aliasAddressId);
			if (!addr?.sharedAliasId) throw new Error(m.cal_caldlg_pick_address());
			sharedAliasId = addr.sharedAliasId;
			key = await aliasKey(accountId, addr.sharedAliasId);
		} else {
			const minted = await mintOwnKey(accountId);
			key = minted.key;
			grants = minted.grants;
		}
		progress = m.cal_caldlg_sealing();
		const sealedMeta = await sealText(accountId, key, serializeMeta(meta()));
		progress = m.cal_caldlg_saving();
		const row = await createCalendar({
			kind,
			sealedMeta,
			metaKeyFingerprint: key.fingerprintB64,
			metaSchemaVersion: META_SCHEMA_VERSION,
			calendarPublicKeyArmored: kind === 'role' ? undefined : key.publicKeyArmored,
			sharedAliasId,
			members: grants
		});
		if (kind !== 'role') await calendarKeys.load(accountId);
		await calendarStore.adoptCalendar(row);
		cal.notify(m.cal_caldlg_created({ name: row.id ? name.trim() : name }));
	}

	async function submitEdit() {
		if (!existing) return;
		if (!name.trim()) throw new Error(m.cal_caldlg_name_required());
		await calendarStore.updateCalendarMeta(existing.id, meta());
		cal.notify(m.cal_caldlg_updated());
	}

	async function submitShare(accountId: string) {
		if (!existing) return;
		const minted = await mintKey(accountId);
		progress = m.cal_caldlg_rotating();
		const row = await rotateCalendarMembers(existing.id, {
			calendarPublicKeyArmored: minted.key.publicKeyArmored,
			members: minted.grants
		});
		await calendarKeys.load(accountId);
		const sealedMeta = await sealText(accountId, minted.key, serializeMeta(existing.meta ?? meta()));
		const patched = await updateCalendar(existing.id, {
			sealedMeta,
			metaKeyFingerprint: minted.key.fingerprintB64,
			metaSchemaVersion: META_SCHEMA_VERSION,
			baseRev: row.rev
		});
		await calendarStore.adoptCalendar(patched);
		progress = m.cal_caldlg_resealing();
		await calendarStore.resealCalendar(existing.id);
		cal.notify(m.cal_caldlg_members_updated());
	}

	async function submitDelete() {
		if (!existing) return;
		await calendarStore.removeCalendar(existing.id);
		cal.notify(m.cal_caldlg_deleted({ name: existing.name }));
	}

	async function submit() {
		const accountId = auth.accountId;
		if (!accountId) return;
		busy = true;
		error = null;
		try {
			if (request.mode === 'create') await submitCreate(accountId);
			else if (request.mode === 'edit') await submitEdit();
			else if (request.mode === 'share') await submitShare(accountId);
			else await submitDelete();
			cal.dialog = null;
			cal.calendarDialog = null;
		} catch (err) {
			error = err instanceof Error ? err.message : m.cal_caldlg_failed();
		} finally {
			busy = false;
			progress = '';
		}
	}
</script>

<Dialog.Content class="cal-surface cal-dlg" showCloseButton>
	<Dialog.Header class="cal-dlg-h">
		{#if request.mode === 'delete'}
			<Trash2 size={18} color="var(--danger-500)" />
		{:else if request.mode === 'share'}
			<KeyRound size={18} color="var(--brass-600)" />
		{:else}
			<CalendarPlus size={18} color="var(--brass-600)" />
		{/if}
		<Dialog.Title class="dt">{title}</Dialog.Title>
	</Dialog.Header>

	<div class="cal-dlg-body cal-form">
		{#if request.mode === 'delete'}
			<p class="cal-dlg-lead">{m.cal_caldlg_delete_lead({ name: existing?.name ?? '' })}</p>
		{:else}
			{#if request.mode === 'create' || request.mode === 'edit'}
				<label class="cal-field">
					<span>{m.cal_caldlg_name()}</span>
					<input type="text" bind:value={name} maxlength="120" placeholder={m.cal_caldlg_name_placeholder()} />
				</label>
				<div class="cal-field">
					<span>{m.cal_caldlg_colour()}</span>
					<div class="swatches">
						{#each PALETTE as c (c)}
							<button
								type="button"
								class="swatch"
								class:on={color === c}
								style:--c={c}
								aria-label={m.cal_caldlg_use_colour_aria({ color: c })}
								onclick={() => (color = c)}
							></button>
						{/each}
					</div>
				</div>
				<label class="cal-field">
					<span>{m.cal_caldlg_description()}</span>
					<input type="text" bind:value={description} maxlength="240" placeholder={m.cal_caldlg_optional()} />
				</label>
				<div class="cal-field">
					<span>{m.cal_caldlg_default_privacy()}</span>
					<div class="seg">
						{#each [['private', m.cal_privacy_private()], ['busy', m.cal_privacy_busy()], ['shared', m.cal_privacy_shared()]] as [value, label] (value)}
							<button
								type="button"
								class:on={defaultPrivacy === value}
								onclick={() => (defaultPrivacy = value as Privacy)}
							>
								{label}
							</button>
						{/each}
					</div>
				</div>
			{/if}

			{#if request.mode === 'create'}
				<div class="cal-field">
					<span>{m.cal_caldlg_who()}</span>
					<div class="seg">
						<button type="button" class:on={kind === 'personal'} onclick={() => (kind = 'personal')}>{m.cal_caldlg_who_me()}</button>
						<button type="button" class:on={kind === 'shared'} disabled={!canShare} onclick={() => (kind = 'shared')}>{m.cal_caldlg_who_members()}</button>
						<button type="button" class:on={kind === 'role'} disabled={!isAdmin || !sharedAddresses.length} onclick={() => (kind = 'role')}>{m.cal_caldlg_who_address()}</button>
					</div>
				</div>
			{/if}

			{#if request.mode === 'create' && kind === 'role'}
				<label class="cal-field">
					<span>{m.cal_caldlg_shared_address()}</span>
					<select bind:value={aliasAddressId}>
						<option value="">{m.cal_caldlg_choose_address()}</option>
						{#each sharedAddresses as addr (addr.id)}
							<option value={addr.id}>{addr.email}</option>
						{/each}
					</select>
				</label>
			{/if}

			{#if (request.mode === 'create' && kind === 'shared') || request.mode === 'share'}
				<div class="cal-field">
					<span><Users size={14} /> {m.cal_caldlg_members()}</span>
					<div class="member-list">
						{#each members as member (member.accountId)}
							{@const role = roles[member.accountId] ?? null}
							<div class="member-row" class:on={!!role}>
								<Checkbox
									id="cal-member-{member.accountId}"
									checked={!!role}
									disabled={member.accountId === auth.accountId && request.mode === 'create'}
									onCheckedChange={() => toggle(member.accountId)}
								/>
								<label for="cal-member-{member.accountId}" class="member-name">
									{member.fullName || member.email}
									<span class="member-mail">{member.email}</span>
								</label>
								{#if role}
									<select value={role} onchange={(e) => setRole(member.accountId, (e.currentTarget as HTMLSelectElement).value as CalendarRole)}>
										<option value="owner">{m.cal_role_owner()}</option>
										<option value="editor">{m.cal_role_editor()}</option>
										<option value="viewer">{m.cal_role_viewer()}</option>
									</select>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<DisclosureBoundary heading={m.cal_caldlg_server_learns()} lines={boundary} />
		{/if}

		{#if progress}<div class="cal-progress">{m.cal_caldlg_progress({ step: progress })}</div>{/if}
		{#if error}<div class="cal-error" role="alert">{error}</div>{/if}
	</div>

	<Dialog.Footer class="cal-dlg-foot">
		<div class="grow"></div>
		<Button variant="ghost" disabled={busy} onclick={() => (cal.dialog = null)}>{m.common_cancel()}</Button>
		<Button variant={request.mode === 'delete' ? 'dangerSolid' : 'primary'} disabled={busy} onclick={submit}>
			{request.mode === 'delete' ? m.common_delete() : request.mode === 'share' ? m.cal_caldlg_save_members() : request.mode === 'edit' ? m.common_save() : m.cal_caldlg_create()}
		</Button>
	</Dialog.Footer>
</Dialog.Content>
