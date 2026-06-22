/**
 * Domain Error Hierarchy
 *
 * Layered, type-safe error definitions used across the business logic layer.
 * Each error carries a stable `code` string (for client/server-action mapping),
 * an HTTP `statusCode`, and optional structured `details`.
 *
 * See: design.md > Error Handling > Domain Error Types
 */

export class DomainError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 400,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
    // Preserve stack trace in V8 environments (Node.js)
    Error.captureStackTrace(this, this.constructor);
  }
}

/** 401 — Authentication is required or has failed. */
export class AuthenticationError extends DomainError {
  constructor(message: string = "Authentication failed", details?: Record<string, unknown>) {
    super(message, "UNAUTHENTICATED", 401, details);
  }
}

/** 403 — Authenticated but not permitted to perform this action. */
export class AuthorizationError extends DomainError {
  constructor(message: string = "Not authorized to perform this action", details?: Record<string, unknown>) {
    super(message, "FORBIDDEN", 403, details);
  }
}

/** 400 — Input failed validation. */
export class ValidationError extends DomainError {
  constructor(message: string = "Validation failed", details?: Record<string, unknown>) {
    super(message, "VALIDATION_ERROR", 400, details);
  }
}

/** 404 — The requested resource could not be located. */
export class NotFoundError extends DomainError {
  constructor(resource: string = "Resource", identifier?: string, details?: Record<string, unknown>) {
    const message = identifier
      ? `${resource} not found: ${identifier}`
      : `${resource} not found`;
    super(message, "NOT_FOUND", 404, { resource, identifier, ...details });
  }
}

/** 409 — The request conflicts with the current state of the resource. */
export class ConflictError extends DomainError {
  constructor(message: string = "Resource conflict", details?: Record<string, unknown>) {
    super(message, "CONFLICT", 409, details);
  }
}

/** 502 — An upstream/external service call failed. */
export class ExternalServiceError extends DomainError {
  constructor(
    service: string,
    message: string = "External service failed",
    details?: Record<string, unknown>
  ) {
    super(`${service} error: ${message}`, "EXTERNAL_SERVICE_ERROR", 502, { service, ...details });
  }
}

/**
 * Narrow an unknown caught value into our DomainError hierarchy.
 * Useful in Server Action catch blocks.
 */
export function asDomainError(error: unknown): DomainError | null {
  return error instanceof DomainError ? error : null;
}
