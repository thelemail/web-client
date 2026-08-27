import { CAL_BY_ID, MONTH_NAMES } from './data';

export function fmtTime(min: number, h12: boolean): string {
	const h = Math.floor(min / 60);
	const m = min % 60;
	if (h12) {
		const ap = h < 12 ? 'AM' : 'PM';
		let hh = h % 12;
		if (hh === 0) hh = 12;
		return m === 0 ? `${hh} ${ap}` : `${hh}:${String(m).padStart(2, '0')} ${ap}`;
	}
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function fmtRange(s: number, e: number, h12: boolean): string {
	return `${fmtTime(s, h12)} – ${fmtTime(e, h12)}`;
}

export const colorOf = (calId: string): string => CAL_BY_ID[calId]?.color || 'var(--ink-500)';

const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export function fmtDayLong(dateStr: string): string {
	const [y, m, d] = dateStr.split('-').map(Number);
	const dt = new Date(y, m - 1, d);
	return `${DOW_LONG[dt.getDay()]}, ${d} ${MONTH_NAMES[m - 1]}`;
}
