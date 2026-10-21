import { m } from '$paraglide/messages.js';
import { initialsFor } from '$core/mail/initials';
import { paletteFor } from '$core/mail/avatarPalette';

export interface SenderFields {
	from: string;
	fromAddr: string;
	init: string;
	bg: string;
	fg: string;
	senderMismatch?: true;
}

function canonical(address: string): string {
	return address.trim().normalize('NFC').toLowerCase();
}

export function attestedMismatch(
	attested: string | null | undefined,
	previewAddress: string
): string | null {
	if (!attested) return null;
	return canonical(attested) === canonical(previewAddress) ? null : attested;
}

export function senderFields(
	sender: { display: string; address: string },
	attested: string | null | undefined
): SenderFields {
	const forged = attestedMismatch(attested, sender.address);
	const address = forged ?? sender.address;
	const from = forged ?? (sender.display || sender.address || m.mailbox_unknown_sender());
	return {
		from,
		fromAddr: address,
		init: initialsFor(from, address),
		...paletteFor(address.toLowerCase()),
		...(forged ? { senderMismatch: true as const } : {})
	};
}
