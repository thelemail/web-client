const localPartPattern = /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/i;

export function isValidLocalPart(value: string): boolean {
	return localPartPattern.test(value.trim());
}
