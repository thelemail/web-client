export type RealtimeKind =
	| 'message.created'
	| 'message.updated'
	| 'message.deleted'
	| 'thread.updated'
	| 'mailbox.invalidated'
	| 'draft.created'
	| 'draft.updated'
	| 'draft.deleted'
	| 'scheduled_send.created'
	| 'scheduled_send.invalidated'
	| 'scheduled_send.deleted'
	| 'contact.updated'
	| 'address.created'
	| 'address.updated'
	| 'address.deleted'
	| 'signature.updated'
	| 'signature.deleted'
	| 'settings.updated'
	| 'account.updated'
	| 'lifecycle.updated'
	| 'subscription.updated'
	| 'blocked_sender.created'
	| 'blocked_sender.deleted'
	| 'calendar.created'
	| 'calendar.updated'
	| 'calendar.deleted'
	| 'calendar.invalidated'
	| 'calendar_item.created'
	| 'calendar_item.updated'
	| 'calendar_item.deleted';

export interface WireHint {
	kind: RealtimeKind;
	id?: string;
	thread_id?: string;
	rev?: number;
}

export interface RealtimeHint extends WireHint {
	accountId: string;
}

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'stopped';
