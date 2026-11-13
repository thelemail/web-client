import { browser } from '$app/env';
import { mailbox } from './mailbox.svelte';
import { drafts } from './drafts.svelte';
import { scheduled } from './scheduled.svelte';
import { addresses } from './addresses.svelte';
import { syncAddressUids } from '$core/keys/uid-sync';
import { signatures } from './signatures.svelte';
import { mailCollections } from './mailCollections.svelte';
import { customDomains } from './customDomains.svelte';
import { accountSettings } from './accountSettings.svelte';
import { workspaces } from './workspaces.svelte';
import { aliases } from './aliases.svelte';
import { workspaceAddresses } from './workspaceAddresses.svelte';
import { aliasKeys } from './aliasKeys.svelte';
import { accountKeys } from './accountKeys.svelte';
import { calendarKeys } from './calendarKeys.svelte';
import { composeStore } from './compose.svelte';
import { billing } from './billing.svelte';
import { twofactor } from './twofactor.svelte';
import { bimi } from './bimi.svelte';
import { personAvatars } from './personAvatars.svelte';
import { contacts } from './contacts.svelte';
import { realtime } from '$core/realtime/realtime.svelte';
import { delegations } from './delegations.svelte';
import { readDelegations } from './readDelegations.svelte';
import { auth } from './session.svelte';
import { mailSearch } from './search.svelte';

function broadcastAccountToStores(accountId: string | null): void {
	mailbox.setAccount(accountId);
	contacts.setAccount(accountId);
	drafts.setAccount(accountId);
	scheduled.setAccount(accountId);
	addresses.setAccount(accountId);
	signatures.setAccount(accountId);
	mailCollections.setAccount(accountId);
	customDomains.setAccount(accountId);
	accountSettings.setAccount(accountId);
	workspaces.setAccount(accountId);
	aliases.setAccount(accountId);
	workspaceAddresses.setAccount(accountId);
	accountKeys.setAccount(accountId);
	aliasKeys.setAccount(accountId);
	delegations.setAccount(accountId);
	readDelegations.setAccount(accountId);
	calendarKeys.setAccount(accountId);
	billing.setAccount(accountId);
	composeStore.setAccount(accountId);
	twofactor.setAccount(accountId);
	bimi.setAccount(accountId);
	personAvatars.setAccount(accountId);
	mailSearch.setAccount(accountId);
}

auth.attach({
	accountChanged: broadcastAccountToStores,
	sessionRevived: () => void realtime.sync(),
	vaultOpened: (accountId) => void syncAddressUids(accountId),
	woke: () => realtime.wake(),
	profileLoaded: (me) =>
		accountKeys.noteServerKey(me.accountId, me.keyFingerprint, me.keyVersion, me.email)
});

if (browser) {
	addresses.onPrimaryChange((accountId, email) => auth.reconcilePrimaryEmail(accountId, email));
}

export { auth };
export type { RecoveryState } from './session.svelte';
