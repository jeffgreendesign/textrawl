import { describe, expect, it } from 'vitest';
import {
	AuthenticationError,
	AuthorizationError,
	DatabaseError,
	ExternalServiceError,
	NotFoundError,
	TextrawlError,
	ValidationError,
} from '../errors.js';

describe('custom error hierarchy', () => {
	describe('TextrawlError', () => {
		it('sets default status code and error code', () => {
			const error = new TextrawlError('test error');
			expect(error.message).toBe('test error');
			expect(error.statusCode).toBe(500);
			expect(error.code).toBe('INTERNAL_ERROR');
			expect(error.name).toBe('TextrawlError');
		});

		it('allows custom status code and error code', () => {
			const error = new TextrawlError('test', 418, 'TEAPOT');
			expect(error.statusCode).toBe(418);
			expect(error.code).toBe('TEAPOT');
		});

		it('is an instance of Error', () => {
			const error = new TextrawlError('test');
			expect(error).toBeInstanceOf(Error);
			expect(error).toBeInstanceOf(TextrawlError);
		});
	});

	describe('NotFoundError', () => {
		it('has 404 status code', () => {
			const error = new NotFoundError();
			expect(error.statusCode).toBe(404);
			expect(error.code).toBe('NOT_FOUND');
			expect(error.name).toBe('NotFoundError');
		});

		it('allows custom message', () => {
			const error = new NotFoundError('Document not found');
			expect(error.message).toBe('Document not found');
		});

		it('extends TextrawlError', () => {
			expect(new NotFoundError()).toBeInstanceOf(TextrawlError);
		});
	});

	describe('ValidationError', () => {
		it('has 400 status code', () => {
			const error = new ValidationError();
			expect(error.statusCode).toBe(400);
			expect(error.code).toBe('VALIDATION_ERROR');
		});
	});

	describe('AuthenticationError', () => {
		it('has 401 status code', () => {
			const error = new AuthenticationError();
			expect(error.statusCode).toBe(401);
			expect(error.code).toBe('AUTHENTICATION_ERROR');
		});
	});

	describe('AuthorizationError', () => {
		it('has 403 status code', () => {
			const error = new AuthorizationError();
			expect(error.statusCode).toBe(403);
			expect(error.code).toBe('AUTHORIZATION_ERROR');
		});
	});

	describe('DatabaseError', () => {
		it('has 500 status code', () => {
			const error = new DatabaseError();
			expect(error.statusCode).toBe(500);
			expect(error.code).toBe('DATABASE_ERROR');
		});
	});

	describe('ExternalServiceError', () => {
		it('has 502 status code', () => {
			const error = new ExternalServiceError();
			expect(error.statusCode).toBe(502);
			expect(error.code).toBe('EXTERNAL_SERVICE_ERROR');
		});
	});
});
