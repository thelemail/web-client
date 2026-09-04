import type { RealtimeHint } from './types';

export interface CalendarRealtimeHandlers {
	onHint(hint: RealtimeHint): void;
	onMessage(hint: RealtimeHint): void;
	onResync(full: boolean): void;
}

let handlers: CalendarRealtimeHandlers | null = null;

export function registerCalendarRealtime(next: CalendarRealtimeHandlers): () => void {
	handlers = next;
	return () => {
		if (handlers === next) handlers = null;
	};
}

export function notifyCalendarHint(hint: RealtimeHint): void {
	handlers?.onHint(hint);
}

export function notifyCalendarMessage(hint: RealtimeHint): void {
	handlers?.onMessage(hint);
}

export function notifyCalendarResync(full: boolean): void {
	handlers?.onResync(full);
}
