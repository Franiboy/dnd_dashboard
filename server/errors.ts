import type { NextFunction, Request, Response } from 'express';
import { createLogger } from './logger.js';

const log = createLogger('errorHandler');

export class AppError extends Error {
  readonly statusCode: number;
  readonly isOperational: boolean;

  constructor(statusCode: number, message: string, isOperational = true) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.isOperational = isOperational;
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
      log.error(err.message, { status: err.statusCode });
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
