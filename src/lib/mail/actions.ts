import type { RouteFolder } from './data';

export interface MailActionCaps {
	showArchive: boolean;
	showRestore: boolean;
	showTrash: boolean;
	showDelete: boolean;
	showMarkRead: boolean;
	showStar: boolean;
	showReply: boolean;
	showMove: boolean;
	showSnooze: boolean;
	showUnsnooze: boolean;
}

export function mailActionsFor(folder: RouteFolder): MailActionCaps {
	switch (folder) {
		case 'trash':
			return {
				showArchive: false,
				showRestore: true,
				showTrash: false,
				showDelete: true,
				showMarkRead: true,
				showStar: true,
				showReply: false,
				showMove: false,
				showSnooze: false,
				showUnsnooze: false
			};
		case 'archive':
			return {
				showArchive: false,
				showRestore: true,
				showTrash: true,
				showDelete: false,
				showMarkRead: true,
				showStar: true,
				showReply: true,
				showMove: true,
				showSnooze: true,
				showUnsnooze: false
			};
		case 'spam':
			return {
				showArchive: false,
				showRestore: true,
				showTrash: true,
				showDelete: true,
				showMarkRead: true,
				showStar: false,
				showReply: false,
				showMove: false,
				showSnooze: false,
				showUnsnooze: false
			};
		case 'drafts':
		case 'scheduled':
			return {
				showArchive: false,
				showRestore: false,
				showTrash: false,
				showDelete: false,
				showMarkRead: false,
				showStar: false,
				showReply: false,
				showMove: false,
				showSnooze: false,
				showUnsnooze: false
			};
		case 'snoozed':
			return {
				showArchive: false,
				showRestore: false,
				showTrash: true,
				showDelete: false,
				showMarkRead: true,
				showStar: true,
				showReply: true,
				showMove: false,
				showSnooze: false,
				showUnsnooze: true
			};
		case 'sent':
			return {
				showArchive: true,
				showRestore: false,
				showTrash: true,
				showDelete: false,
				showMarkRead: true,
				showStar: true,
				showReply: true,
				showMove: true,
				showSnooze: false,
				showUnsnooze: false
			};
		case 'inbox':
		case 'starred':
		default:
			return {
				showArchive: true,
				showRestore: false,
				showTrash: true,
				showDelete: false,
				showMarkRead: true,
				showStar: true,
				showReply: true,
				showMove: true,
				showSnooze: true,
				showUnsnooze: false
			};
	}
}
