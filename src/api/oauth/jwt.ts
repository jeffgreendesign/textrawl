import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { config } from '../../utils/config.js';

function getSecret(): Uint8Array {
	return new TextEncoder().encode(config.OAUTH_JWT_SECRET);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function signJwt(payload: Record<string, any>, expiresIn: string): Promise<string> {
	return new SignJWT(payload)
		.setProtectedHeader({ alg: 'HS256' })
		.setIssuedAt()
		.setIssuer(config.OAUTH_SERVER_URL ?? 'textrawl')
		.setExpirationTime(expiresIn)
		.sign(getSecret());
}

export async function verifyJwt(token: string): Promise<JWTPayload> {
	const { payload } = await jwtVerify(token, getSecret(), {
		issuer: config.OAUTH_SERVER_URL ?? 'textrawl',
	});
	return payload;
}
