import express, { Router } from 'express';
import { config } from '../../utils/config.js';
import { ValidationError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { signJwt, verifyJwt } from './jwt.js';
import { verifyPkce } from './pkce.js';
import type { AuthCodePayload, AuthSessionPayload, AuthorizeParams, TokenRequest } from './types.js';

export const oauthRoutes = Router();

// OAuth 2.0 Protected Resource Metadata (RFC 9728)
oauthRoutes.get('/.well-known/oauth-protected-resource', (_req, res) => {
	const serverUrl = config.OAUTH_SERVER_URL;
	res.json({
		resource: serverUrl,
		authorization_servers: [serverUrl],
		bearer_methods_supported: ['header'],
	});
});

oauthRoutes.get('/.well-known/oauth-protected-resource/mcp', (_req, res) => {
	const serverUrl = config.OAUTH_SERVER_URL;
	res.json({
		resource: `${serverUrl}/mcp`,
		authorization_servers: [serverUrl],
		bearer_methods_supported: ['header'],
	});
});

// OAuth 2.0 Authorization Server Metadata (RFC 8414)
oauthRoutes.get('/.well-known/oauth-authorization-server', (_req, res) => {
	const serverUrl = config.OAUTH_SERVER_URL;
	res.json({
		issuer: serverUrl,
		authorization_endpoint: `${serverUrl}/authorize`,
		token_endpoint: `${serverUrl}/token`,
		response_types_supported: ['code'],
		grant_types_supported: ['authorization_code'],
		code_challenge_methods_supported: ['S256'],
	});
});

// Step 1: Claude/ChatGPT redirects user here
oauthRoutes.get('/authorize', async (req, res, next) => {
	try {
		const params = req.query as unknown as AuthorizeParams;

		if (params.response_type !== 'code') {
			throw new ValidationError('response_type must be "code"');
		}
		if (!params.client_id || !params.redirect_uri || !params.state) {
			throw new ValidationError('Missing required parameters: client_id, redirect_uri, state');
		}
		if (!params.code_challenge || params.code_challenge_method !== 'S256') {
			throw new ValidationError('PKCE with S256 is required');
		}

		// Store OAuth session data in a signed JWT, passed as Google's state param
		const sessionPayload: AuthSessionPayload = {
			redirect_uri: params.redirect_uri,
			code_challenge: params.code_challenge,
			code_challenge_method: params.code_challenge_method,
			client_id: params.client_id,
			state: params.state,
		};
		const sessionToken = await signJwt({ ...sessionPayload }, '10m');

		// Redirect to Google OAuth consent screen
		const googleAuthUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
		googleAuthUrl.searchParams.set('client_id', config.GOOGLE_CLIENT_ID!);
		googleAuthUrl.searchParams.set('redirect_uri', `${config.OAUTH_SERVER_URL}/oauth/callback`);
		googleAuthUrl.searchParams.set('response_type', 'code');
		googleAuthUrl.searchParams.set('scope', 'openid email');
		googleAuthUrl.searchParams.set('state', sessionToken);
		googleAuthUrl.searchParams.set('access_type', 'online');

		logger.debug('OAuth authorize: redirecting to Google');
		res.redirect(googleAuthUrl.toString());
	} catch (error) {
		next(error);
	}
});

// Step 2: Google redirects back here after user consents
oauthRoutes.get('/oauth/callback', async (req, res, next) => {
	try {
		const { code, state } = req.query as { code?: string; state?: string };

		if (!code || !state) {
			throw new ValidationError('Missing code or state from Google callback');
		}

		// Verify and decode our session JWT from state
		const session = await verifyJwt(state) as unknown as AuthSessionPayload;

		// Exchange Google auth code for tokens
		const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				code,
				client_id: config.GOOGLE_CLIENT_ID,
				client_secret: config.GOOGLE_CLIENT_SECRET,
				redirect_uri: `${config.OAUTH_SERVER_URL}/oauth/callback`,
				grant_type: 'authorization_code',
			}),
		});

		if (!tokenResponse.ok) {
			const err = await tokenResponse.text();
			logger.error('Google token exchange failed', { error: err });
			throw new ValidationError('Google authentication failed');
		}

		const googleTokens = (await tokenResponse.json()) as { access_token: string };

		// Get user email from Google
		const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
			headers: { Authorization: `Bearer ${googleTokens.access_token}` },
		});

		if (!userInfoResponse.ok) {
			throw new ValidationError('Failed to get user info from Google');
		}

		const userInfo = (await userInfoResponse.json()) as { email: string };

		// Check email allowlist
		const allowedEmails = config.OAUTH_ALLOWED_EMAILS
			?.split(',')
			.map((e) => e.trim().toLowerCase()) ?? [];

		if (allowedEmails.length > 0 && !allowedEmails.includes(userInfo.email.toLowerCase())) {
			logger.warn('OAuth: email not in allowlist', { email: userInfo.email });
			throw new ValidationError('Email not authorized');
		}

		// Create our authorization code (short-lived JWT)
		const authCodePayload: AuthCodePayload = {
			email: userInfo.email,
			redirect_uri: session.redirect_uri,
			code_challenge: session.code_challenge,
		};
		const authCode = await signJwt({ ...authCodePayload }, '5m');

		// Redirect back to Claude/ChatGPT with our auth code
		const redirectUrl = new URL(session.redirect_uri);
		redirectUrl.searchParams.set('code', authCode);
		redirectUrl.searchParams.set('state', session.state);

		logger.debug('OAuth callback: redirecting back to client', { email: userInfo.email });
		res.redirect(redirectUrl.toString());
	} catch (error) {
		next(error);
	}
});

// Step 3: Claude/ChatGPT exchanges auth code for access token
// OAuth token requests use application/x-www-form-urlencoded per RFC 6749
oauthRoutes.post('/token', express.urlencoded({ extended: false }), async (req, res, next) => {
	try {
		const body = req.body as TokenRequest;

		if (body.grant_type !== 'authorization_code') {
			throw new ValidationError('grant_type must be "authorization_code"');
		}
		if (!body.code || !body.code_verifier) {
			throw new ValidationError('Missing required parameters: code, code_verifier');
		}

		// Verify the authorization code JWT
		const authCode = await verifyJwt(body.code) as unknown as AuthCodePayload;

		// Verify PKCE
		if (!verifyPkce(body.code_verifier, authCode.code_challenge)) {
			throw new ValidationError('PKCE verification failed');
		}

		// Verify redirect_uri matches
		if (body.redirect_uri && body.redirect_uri !== authCode.redirect_uri) {
			throw new ValidationError('redirect_uri mismatch');
		}

		// Issue long-lived access token
		const accessToken = await signJwt(
			{ sub: authCode.email },
			'30d',
		);

		logger.debug('OAuth token: issued access token', { email: authCode.email });

		res.json({
			access_token: accessToken,
			token_type: 'Bearer',
			expires_in: 30 * 24 * 60 * 60, // 30 days in seconds
		});
	} catch (error) {
		next(error);
	}
});
