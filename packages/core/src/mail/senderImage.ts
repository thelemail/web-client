import { bimi } from '$core/stores/bimi.svelte';
import { personAvatars } from '$core/stores/personAvatars.svelte';

export interface SenderImage {
	src: string | null;
	fit: 'contain' | 'cover';
	imgBg?: string;
}

export function senderImage(address?: string, bimiDomain?: string): SenderImage {
	const photo = personAvatars.avatarUrl(address);
	if (photo) return { src: photo, fit: 'cover' };
	return { src: bimi.logoUrl(bimiDomain), fit: 'contain', imgBg: '#fff' };
}
