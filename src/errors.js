export class AppError extends Error {
  constructor(message, { code, status, expose = true, cause } = {}) {
    super(message, { cause });
    this.name = this.constructor.name;
    this.code = code ?? 'internal_error';
    this.status = status ?? 500;
    this.expose = expose;
  }
}

export class ValidationError extends AppError {
  constructor(message) {
    super(message, { code: 'invalid_request', status: 400 });
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'valid bearer authentication is required') {
    super(message, { code: 'unauthenticated', status: 401 });
  }
}

export class AuthorizationError extends AppError {
  constructor(message = 'link is not owned by this principal') {
    super(message, { code: 'forbidden', status: 403 });
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'short link was not found') {
    super(message, { code: 'not_found', status: 404 });
  }
}

export class GoneError extends AppError {
  constructor(message = 'short link is no longer active') {
    super(message, { code: 'gone', status: 410 });
  }
}

export class RequestConflictError extends AppError {
  constructor(message = 'idempotency key was already used with another payload') {
    super(message, { code: 'idempotency_conflict', status: 409 });
  }
}

export class AliasConflictError extends AppError {
  constructor(message = 'requested short code is unavailable') {
    super(message, { code: 'alias_conflict', status: 409 });
  }
}

export class PreconditionError extends AppError {
  constructor(message = 'link version does not match If-Match') {
    super(message, { code: 'precondition_failed', status: 412 });
  }
}

export class CodeSpaceExhaustedError extends AppError {
  constructor() {
    super('short code allocation exhausted its bounded retry budget', {
      code: 'allocation_unavailable',
      status: 503,
    });
  }
}

export class DependencyError extends AppError {
  constructor(message = 'required storage is unavailable', cause) {
    super(message, { code: 'dependency_unavailable', status: 503, expose: true, cause });
  }
}
