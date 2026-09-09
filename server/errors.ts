import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { createLogger } from './logger.js';

const log = createLogger('errorHandler');

export class AppError extends Error {
  readonly statusCode: number;
  readonly isOperational: boolean;

  constructor(
    statusCode: number,
    message: string,
    options: { isOperational?: boolean; cause?: unknown } = {}
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.isOperational = options.isOperational ?? true;
  }
}

/**
 * Validates `data` against a zod schema and returns the parsed value.
 * The first issue's message becomes a 400 AppError, so route handlers stay
 * free of hand-written validation boilerplate and responses keep their
 * user-facing German error texts.
 */
export function parseWith<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new AppError(400, result.error.issues[0]?.message ?? 'Ungültige Daten');
  }
  return result.data;
}

/**
 * Runs a synchronous repository call and maps failures to a 500 AppError with
 * a stable user-facing message while keeping the underlying cause for the log.
 * Existing AppErrors pass through unchanged.
 */
export function orFail<T>(message: string, fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, message, { cause: err });
  }
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not Found' });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      // Log the underlying cause (repository/SQL failure) instead of only the
      // user-facing message, so 5xx responses stay diagnosable.
      if (err.cause !== undefined) {
        log.error(`${err.statusCode} ${err.message}:`, err.cause);
      } else {
        log.error(`${err.statusCode} ${err.message}`, err.stack);
      }
    }
    res.status(err.statusCode).json({ error: err.message });
    return;
  }

  if (
    err instanceof SyntaxError &&
    'status' in err &&
    (err as { status?: number }).status === 400
  ) {
    res.status(400).json({ error: 'Invalid JSON payload' });
    return;
  }

  log.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
}
