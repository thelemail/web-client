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
		live.notify('Not built in this preview');
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
			this.notify('Choose who owns the consent form first');
			return;
		}
		const n = this.mailSelectedCount;
		if (!n) return;
		live.dialog = null;
		this.mailDone = true;
		live.goTo('week');
		this.notify(`${n} commitments added · Marie owns the consent form`);
	}

	dropSlot(index: number) {
		this.offeredSlots = this.offeredSlots.filter((i) => i !== index);
	}

	addSlot() {
		const next = [0, 1, 2, 3].find((i) => !this.offeredSlots.includes(i));
		if (next === undefined) {
			this.notify('No further free slots this week');
			return;
		}
		this.offeredSlots = [...this.offeredSlots, next].sort();
	}

	get slotDisclosure() {
		const n = this.offeredSlots.length;
		return `${count(COUNT_WORDS, n)} candidate time${n === 1 ? '' : 's'}, your name, and the sending identity.`;
	}

	get whyHeading() {
		const n = this.offeredSlots.length;
		return `Why ${count(COUNT_WORDS, n)} time${n === 1 ? '' : 's'}`;
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
			return 'No offered time works for both. Thelemail will suggest more rather than pick one.';
		}
		const when = SLOTS[both[0]].when;
		const label = when.replace(/,.*/, '') + when.slice(when.indexOf(','));
		const lead =
			both.length === 1
				? `${label} is the only time both can make.`
				: `${both.length} of the offered times work for both.`;
		return `${lead} Thelemail will not book it for you — it will offer to.`;
	}

	confirmOffer() {
		live.dialog = null;
		this.notify('Times inserted · a Proposal is holding them for you');
	}

	toggleMirror(key: 'work' | 'school' | 'gcal') {
		const was = this.mirrors[key];
		this.mirrors = { ...this.mirrors, [key]: !was };
		if (key === 'gcal') {
			this.notify(
				was
					? 'Mirror off · Google keeps nothing new'
					: 'Busy windows will leave Thelemail for Google'
			);
		}
	}

	toggleBookingRequest() {
		const was = this.bookingRequest;
		this.bookingRequest = !was;
		this.bookingSlot = null;
		this.notify(
			was ? 'Visitors book directly again' : 'Visitors now request · each becomes a Proposal'
		);
	}

	pickBookingDay(index: number) {
		this.bookingDay = index;
		this.bookingSlot = null;
	}

	get bookingCta() {
		if (this.bookingSlot === null) return 'Pick a time';
		const slot = BOOKING_DAYS[this.bookingDay].slots[this.bookingSlot];
		return this.bookingRequest ? `Request ${slot}` : `Confirm ${slot}`;
	}

	confirmBooking() {
		if (this.bookingSlot === null) {
			this.notify('Pick a time first');
			return;
		}
		this.notify(
			this.bookingRequest
				? 'Request sent · a Proposal is waiting on bookings@thelema.co'
				: 'Booked · invitation sent as bookings@thelema.co'
		);
	}
}

export const cal = new PreviewState();
