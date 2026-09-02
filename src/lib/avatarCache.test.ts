import { describe, it, expect } from 'vitest';
import { imageMimeFromBytes, sourcePath } from './avatarCache.svelte';

function bytes(head: number[], length = 16): Uint8Array {
	const out = new Uint8Array(length);
	out.set(head);
	return out;
}

describe('imageMimeFromBytes', () => {
	it('recognises jpeg', () => {
		expect(imageMimeFromBytes(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
	});

	it('recognises png', () => {
		expect(imageMimeFromBytes(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
			'image/png'
		);
	});

	it('recognises gif', () => {
		expect(imageMimeFromBytes(bytes([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe('image/gif');
	});

	it('recognises webp', () => {
		const riff = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];
		expect(imageMimeFromBytes(bytes(riff))).toBe('image/webp');
	});

	it('rejects anything else', () => {
		expect(imageMimeFromBytes(bytes([0x3c, 0x73, 0x76, 0x67]))).toBeNull();
		expect(imageMimeFromBytes(new Uint8Array(4))).toBeNull();
	});
});

describe('sourcePath', () => {
	it('drops the presigned query so a re-signed url still matches', () => {
		expect(sourcePath('https://store.example/avatars/a/b.jpg?X-Amz-Signature=1')).toBe(
			sourcePath('https://store.example/avatars/a/b.jpg?X-Amz-Signature=2')
		);
	});

	it('differs when the object key differs', () => {
		expect(sourcePath('https://store.example/avatars/a/b.jpg')).not.toBe(
			sourcePath('https://store.example/avatars/a/c.jpg')
		);
	});
});
