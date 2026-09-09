import { electLeader, type LeaderHandle } from '$core/realtime/leader';
import { longWhen } from './format';
import { calendarStore } from './store.svelte';

const TICK_MS = 30_000;
const LOOKAHEAD_MS = 24 * 60 * 60 * 1000;
const FIRED_KEY = 'thelemail:calendar:reminders-fired';

export type ReminderPermission = 'granted' | 'denied' | 'default' | 'unsupported';

export function reminderPermission(): ReminderPermission {
	if (typeof Notification === 'undefined') return 'unsupported';
	return Notification.permission;
}

export async function requestReminderPermission(): Promise<ReminderPermission> {
	if (typeof Notification === 'undefined') return 'unsupported';
	try {
		return await Notification.requestPermission();
	} catch {
		return Notification.permission;
	}
}

function loadFired(): Set<string> {
	try {
		const raw = sessionStorage.getItem(FIRED_KEY);
		return new Set(raw ? (JSON.parse(raw) as string[]) : []);
	} catch {
		return new Set();
	}
}

function saveFired(fired: Set<string>): void {
	try {
		sessionStorage.setItem(FIRED_KEY, JSON.stringify([...fired].slice(-500)));
	} catch {
		return;
	}
}

export interface ReminderNotice {
	key: string;
	title: string;
	body: string;
	at: Date;
}

export type ReminderSink = (notice: ReminderNotice) => void;

export function startReminders(fallback: ReminderSink): () => void {
	let leader: LeaderHandle | null = null;
	let timer: ReturnType<typeof setInterval> | null = null;
	const fired = loadFired();

	const tick = () => {
		if (!calendarStore.loaded) return;
		const now = new Date();
		const to = new Date(now.getTime() + LOOKAHEAD_MS);
		for (const occ of calendarStore.occurrencesIn(now, to, { includeHidden: true })) {
			const reminders = occ.item.reminders ?? [];
			if (!reminders.length || occ.done) continue;
			const snoozed = calendarStore.myState(occ.item.id)?.snoozedReminders ?? [];
			for (const r of reminders) {
				const at = new Date(occ.start.getTime() - r.minutesBefore * 60000);
				if (at > now || now.getTime() - at.getTime() > TICK_MS * 2) continue;
				const key = `${occ.key}:${r.minutesBefore}`;
				if (fired.has(key) || snoozed.includes(key)) continue;
				fired.add(key);
				saveFired(fired);
				const title = occ.item.kind === 'hold' ? 'Busy' : occ.title || '(untitled)';
				const body = occ.location ? `${longWhen(occ)} · ${occ.location}` : longWhen(occ);
				const notice: ReminderNotice = { key, title, body, at: occ.start };
				if (reminderPermission() === 'granted' && document.visibilityState !== 'visible') {
					try {
						const n = new Notification(title, { body, tag: key });
						n.onclick = () => window.focus();
						continue;
					} catch {
						fallback(notice);
						continue;
					}
				}
				fallback(notice);
			}
		}
	};

	leader = electLeader('thelemail:calendar-reminders', () => {
		tick();
		timer = setInterval(tick, TICK_MS);
		return () => {
			if (timer) clearInterval(timer);
			timer = null;
		};
	});

	return () => {
		leader?.stop();
		leader = null;
	};
}
