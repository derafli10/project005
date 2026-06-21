export class DomainError extends Error {
  constructor(public message: string, public code: string, public statusCode: number = 400) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class AuthenticationError extends DomainError {
  constructor(message: string = "Authentication failed") {
    super(message, "UNAUTHENTICATED", 401);
  }
}

export class ValidationError extends DomainError {
  constructor(message: string = "Validation failed") {
    super(message, "VALIDATION_ERROR", 400);
  }
}

export class NotFoundError extends DomainError {
  constructor(message: string = "Resource not found") {
    super(message, "NOT_FOUND", 404);
  }
}

export class ConflictError extends DomainError {
  constructor(message: string = "Resource conflict") {
    super(message, "CONFLICT", 409);
  }
}

export class ExternalServiceError extends DomainError {
  constructor(message: string = "External service failed") {
    super(message, "EXTERNAL_SERVICE_ERROR", 502);
  }
}
