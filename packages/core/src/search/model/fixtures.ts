import { Field } from '../sqlite/types';
import type { EmbedInput } from './protocol';

function body(text: string, subject: string | null = null): EmbedInput {
	return { subject, parts: [{ ordinal: 1, field: Field.body, text, attachmentId: null, place: null }] };
}

const LONG = Array.from(
	{ length: 240 },
	(_, i) => `Paragraph ${i} of the quarterly review covers ${['travel costs', 'hiring plans', 'supplier contracts', 'office leases'][i % 4]} in detail.`
).join('\n\n');

export const FIXTURES: Record<string, EmbedInput> = {
	english: body('The flight to Lisbon was cancelled and the refund has not arrived yet.', 'Refund for cancelled flight'),
	portuguese: body('O voo para Lisboa foi cancelado e o reembolso ainda não chegou.', 'Reembolso do voo cancelado'),
	russian: body('Рейс в Лиссабон отменили, а деньги за билет до сих пор не вернули.', 'Возврат за отменённый рейс'),
	german: body('Bitte schicken Sie mir die unterschriebene Rechnung bis Freitag.'),
	long: body(LONG, 'Quarterly review')
};
