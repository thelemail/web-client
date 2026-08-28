import type { Message } from './data';
import type { Query } from './url';

export function queryMatches(q: Query, m: Message): boolean {
	if (q.folder === 'starred') {
		if (!m.starred || m.folder === 'trash' || m.folder === 'spam') return false;
	} else if (m.folder !== q.folder) {
		return false;
	}
	if (q.unread && !m.unread) return false;
	if (q.attach && !(m.attachments?.length ?? 0)) return false;
	if (q.labels.length && !q.labels.some((l) => m.labels.includes(l))) return false;
	return true;
}
