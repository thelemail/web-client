import { customFolderId, customFolderRoute, customLabelId, type Message } from './data';
import type { Query } from './url';

export type Subtree = (id: string) => readonly string[];

const selfOnly: Subtree = (id) => [id];

const LABEL_VIEW_HIDDEN = new Set(['trash', 'spam', 'drafts', 'scheduled']);

export function queryMatches(q: Query, m: Message, subtree: Subtree = selfOnly): boolean {
	const expand = (id: string) => (q.direct ? [id] : subtree(id));
	const folderId = customFolderId(q.folder);
	const labelId = customLabelId(q.folder);
	if (q.folder === 'starred') {
		if (!m.starred || m.folder === 'trash' || m.folder === 'spam') return false;
	} else if (q.folder === 'inbox') {
		if (m.folder !== 'inbox' && m.folder !== 'sent') return false;
	} else if (folderId) {
		if (!expand(folderId).some((id) => m.folder === customFolderRoute(id))) return false;
	} else if (labelId) {
		if (LABEL_VIEW_HIDDEN.has(m.folder)) return false;
		if (!expand(labelId).some((id) => m.labels.includes(id))) return false;
	} else if (m.folder !== q.folder) {
		return false;
	}
	if (q.unread && !m.unread) return false;
	if (q.attach && !(m.attachments?.length ?? 0)) return false;
	if (q.labels.length && !q.labels.some((l) => expand(l).some((id) => m.labels.includes(id)))) {
		return false;
	}
	return true;
}
