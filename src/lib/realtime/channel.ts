import type { ConnectionState, RealtimeHint } from './types';

export type ChannelMessage =
	| { type: 'hint'; hint: RealtimeHint }
	| { type: 'state'; accountId: string; state: ConnectionState }
	| { type: 'device'; deviceId: string }
	| { type: 'bye'; deviceId: string };

export interface RealtimeChannel {
	post(msg: ChannelMessage): void;
	close(): void;
}

const CHANNEL_NAME = 'thelemail:realtime';

export function openRealtimeChannel(onMessage: (msg: ChannelMessage) => void): RealtimeChannel {
	if (typeof BroadcastChannel === 'undefined') {
		return { post() {}, close() {} };
	}
	const bc = new BroadcastChannel(CHANNEL_NAME);
	bc.onmessage = (ev: MessageEvent) => onMessage(ev.data as ChannelMessage);
	return {
		post(msg: ChannelMessage) {
			bc.postMessage(msg);
		},
		close() {
			bc.close();
		}
	};
}
