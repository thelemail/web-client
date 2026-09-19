import { m } from '$paraglide/messages.js';
import { cal as live } from '../state.svelte';
import { ANSWERS, BOOKING_DAYS, COUNT_WORDS, PEOPLE, SLOTS } from './fixtures';

function count(words: string[], n: number): string {
	return words[n] ?? String(n);
}

class PreviewState {
	mailSelected = $state<Record<string, boolean>>({
		p1: true,
		p2: true,
		p3: true
	});
	mailOwner = $state<'marie' | 'you' | null>(null);
	mailDone = $state(false);
	offeredSlots = $state<number[]>([0, 1, 2]);
	mirrors = $state({ work: true, school: true, gcal: true });
	bookingDay = $state(1);
	bookingSlot = $state<number | null>(null);
	bookingRequest = $state(false);

	get dialog() {
		return live.dialog;
	}

	set dialog(value) {
		live.dialog = value;
	}

	notify(message: string) {
		live.notify(message);
	}

	unbuilt() {
		live.notify(m.cal_preview_unbuilt());
	}

	toggleMailProposal(key: string) {
		this.mailSelected = {
			...this.mailSelected,
			[key]: !this.mailSelected[key]
		};
	}

	get mailSelectedCount() {
		return Object.values(this.mailSelected).filter(Boolean).length;
	}

	get mailOwnerMissing() {
		return this.mailSelected.p2 && !this.mailOwner;
	}

	confirmMail() {
		if (this.mailOwnerMissing) {
			this.notify(m.cal_preview_choose_owner());
			return;
		}
		const n = this.mailSelectedCount;
		if (!n) return;
		live.dialog = null;
		this.mailDone = true;
		live.goTo('week');
		this.notify(m.cal_preview_added({ count: n }));
	}

	dropSlot(index: number) {
		this.offeredSlots = this.offeredSlots.filter((i) => i !== index);
	}

	addSlot() {
		const next = [0, 1, 2, 3].find((i) => !this.offeredSlots.includes(i));
		if (next === undefined) {
			this.notify(m.cal_preview_no_slots());
			return;
		}
		this.offeredSlots = [...this.offeredSlots, next].sort();
	}

	get slotDisclosure() {
		const n = this.offeredSlots.length;
		return m.cal_preview_slot_disclosure({ n, count: count(COUNT_WORDS, n) });
	}

	get whyHeading() {
		const n = this.offeredSlots.length;
		return m.cal_preview_why_heading({ n, count: count(COUNT_WORDS, n) });
	}

	get hasTightSlot() {
		return this.offeredSlots.includes(2);
	}

	get pollColumns() {
		return this.offeredSlots.map((i) => {
			const when = SLOTS[i].when;
			const time = when.match(/\d\d:\d\d/)?.[0] ?? '';
			return {
				index: i,
				label: `${when.replace(/ June.*/, '').replace(/,.*/, '')} ${time}`
			};
		});
	}

	get pollRows() {
		return (['panurge', 'alex'] as const).map((key) => {
			const person = PEOPLE[key];
			return {
				key,
				init: person.init,
				name: person.full,
				external: !!person.external,
				bg: person.bg,
				fg: person.fg,
				cells: this.offeredSlots.map((i) => ({
					index: i,
					yes: ANSWERS[key][i]
				}))
			};
		});
	}

	get pollNote() {
		const both = this.offeredSlots.filter((i) => ANSWERS.panurge[i] && ANSWERS.alex[i]);
		if (!both.length) {
			return m.cal_preview_poll_none();
		}
		const when = SLOTS[both[0]].when;
		const label = when.replace(/,.*/, '') + when.slice(when.indexOf(','));
		return both.length === 1
			? m.cal_preview_poll_only({ label })
			: m.cal_preview_poll_many({ count: both.length });
	}

	confirmOffer() {
		live.dialog = null;
		this.notify(m.cal_preview_times_inserted());
	}

	toggleMirror(key: 'work' | 'school' | 'gcal') {
		const was = this.mirrors[key];
		this.mirrors = { ...this.mirrors, [key]: !was };
		if (key === 'gcal') {
			this.notify(
				was
					? m.cal_preview_mirror_off()
					: m.cal_preview_mirror_on()
			);
		}
	}

	toggleBookingRequest() {
		const was = this.bookingRequest;
		this.bookingRequest = !was;
		this.bookingSlot = null;
		this.notify(
			was ? m.cal_preview_book_direct() : m.cal_preview_book_request()
		);
	}

	pickBookingDay(index: number) {
		this.bookingDay = index;
		this.bookingSlot = null;
	}

	get bookingCta() {
		if (this.bookingSlot === null) return m.cal_preview_pick_time();
		const slot = BOOKING_DAYS[this.bookingDay].slots[this.bookingSlot];
		return this.bookingRequest ? m.cal_preview_request_slot({ slot }) : m.cal_preview_confirm_slot({ slot });
	}

	confirmBooking() {
		if (this.bookingSlot === null) {
			this.notify(m.cal_preview_pick_time_first());
			return;
		}
		this.notify(
			this.bookingRequest
				? m.cal_preview_request_sent({ email: 'bookings@thelema.co' })
				: m.cal_preview_booked({ email: 'bookings@thelema.co' })
		);
	}
}

export const cal = new PreviewState();
