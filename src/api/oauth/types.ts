export interface AuthorizeParams {
	response_type: string;
	client_id: string;
	redirect_uri: string;
	state: string;
	code_challenge: string;
	code_challenge_method: string;
	scope?: string;
}

export interface TokenRequest {
	grant_type: string;
	code: string;
	redirect_uri: string;
	client_id: string;
	code_verifier: string;
}

export interface AuthSessionPayload {
	redirect_uri: string;
	code_challenge: string;
	code_challenge_method: string;
	client_id: string;
	state: string;
}

export interface AuthCodePayload {
	email: string;
	redirect_uri: string;
	code_challenge: string;
}

export interface AccessTokenPayload {
	sub: string;
	iss: string;
}
