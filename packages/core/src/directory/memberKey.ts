import { lookupDirectory } from './lookup';
import { DirectoryVerificationError } from './errors';
import { verifyDirectoryLookup } from './verify';

export async function verifiedMemberKey(email: string, accountId: string): Promise<string> {
	const address = email.trim().toLowerCase();
	const lookup = await lookupDirectory(email);
	const res = await verifyDirectoryLookup(lookup, address);
	if (res.statement.accountId !== accountId) {
		throw new DirectoryVerificationError(
			'address_mismatch',
			`directory record for ${address} belongs to account ${res.statement.accountId}, not ${accountId}`,
			{ requestedAddress: address, statementAddress: res.statement.address }
		);
	}
	return res.publicKeyArmored;
}
