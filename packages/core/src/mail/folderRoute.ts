const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isCollectionId(value: string): boolean {
	return UUID_RE.test(value);
}

export type RouteFolder =
	| 'inbox'
	| 'starred'
	| 'sent'
	| 'drafts'
	| 'scheduled'
	| 'snoozed'
	| 'archive'
	| 'spam'
	| 'trash';

export const ROUTE_FOLDERS: readonly RouteFolder[] = [
	'inbox',
	'starred',
	'sent',
	'drafts',
	'scheduled',
	'snoozed',
	'archive',
	'spam',
	'trash'
];

export function isRouteFolder(value: string): value is RouteFolder {
	return (ROUTE_FOLDERS as readonly string[]).includes(value);
}

export type CustomFolderRoute = `f-${string}`;

export type MailFolderRoute = RouteFolder | CustomFolderRoute;

const CUSTOM_FOLDER_PREFIX = 'f-';

export function customFolderRoute(folderId: string): CustomFolderRoute {
	return `${CUSTOM_FOLDER_PREFIX}${folderId}`;
}

export function customFolderId(route: string): string | null {
	if (!route.startsWith(CUSTOM_FOLDER_PREFIX)) return null;
	const id = route.slice(CUSTOM_FOLDER_PREFIX.length);
	return isCollectionId(id) ? id.toLowerCase() : null;
}

export function isMailFolderRoute(value: string): value is MailFolderRoute {
	return isRouteFolder(value) || customFolderId(value) !== null;
}
