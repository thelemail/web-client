import { m } from '$paraglide/messages.js';
import { mailCollections } from '$core/stores/mailCollections.svelte';
import { customFolderId } from './folderRoute';
import { FOLDERS } from './data';

export interface MailLocation {
	route: string;
	name: string;
	path: string;
	custom: boolean;
}

function sameHome(route: string, view: string): boolean {
	if (route === view) return true;
	return view === 'inbox' && route === 'sent';
}

export function locationOf(route: string): MailLocation | null {
	const folderId = customFolderId(route);
	if (folderId) {
		const entry = mailCollections.folder(folderId);
		if (!entry || entry.sealed) return null;
		return { route, name: entry.name, path: entry.path, custom: true };
	}
	const system = FOLDERS.find((f) => f.id === route);
	if (!system) return null;
	return { route, name: system.label, path: system.label, custom: false };
}

export function locationFor(route: string, view: string, searching: boolean): MailLocation | null {
	if (!searching && sameHome(route, view)) return null;
	return locationOf(route);
}

export function locationLabel(location: MailLocation): string {
	return m.mail_location_in({ place: location.path });
}
