export const BACKUP_CODE_PLACEHOLDER = 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX';
export const BACKUP_CODE_MAX_LENGTH = 48;
export const BACKUP_CODE_MIN_LENGTH = 8;

export function backupCodesFile(codes: string[], email: string, generated: Date = new Date()): Blob {
	const lines = [
		'Thelemail two-factor backup codes',
		'=================================',
		'',
		`Account:   ${email}`,
		`Generated: ${generated.toISOString().slice(0, 10)}`,
		'',
		'Each code signs you in once if you lose your second factor:',
		'',
		...codes.map((c, i) => `  ${String(i + 1).padStart(2, ' ')}. ${c}`),
		'',
		'Keep these offline. Anyone with a code and your password can sign in.',
		''
	];
	return new Blob([lines.join('\n')], { type: 'text/plain' });
}
