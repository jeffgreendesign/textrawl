import { createHash } from 'node:crypto';

export function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
	const computed = createHash('sha256')
		.update(codeVerifier)
		.digest('base64url');
	return computed === codeChallenge;
}
