import { describe, expect, it } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { AppError, errorHandler, notFoundHandler } from './errors.js';

interface MockRes {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  status: (code: number) => MockRes;
  json: (body: unknown) => MockRes;
  set: (name: string, value: string) => MockRes;
}

function makeRes(): MockRes {
  const res: MockRes = {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
    set(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
  };
  return res;
}

describe('AppError', () => {
  it('carries a status code and is operational by default', () => {
    const err = new AppError(404, 'Missing');
    expect(err.statusCode).toBe(404);
    expect(err.isOperational).toBe(true);
    expect(err.message).toBe('Missing');
  });

  it('infers a stable code for a known legacy producer message', () => {
    const err = new AppError(401, 'Falsche Anmeldedaten');
    const res = makeRes();
    errorHandler(err, {} as Request, res as unknown as Response, () => {});
    expect(res.body).toMatchObject({
      errorCode: 'auth.invalidCredentials',
      messageKey: 'auth.invalidCredentials',
    });
  });

  it('keeps structured message metadata for API clients', () => {
    const err = new AppError(400, 'Zu viele Aufgaben', {
      messageKey: 'errors.bingo.minimumTasks',
      params: { count: 3 },
    });
    const res = makeRes();
    errorHandler(err, {} as Request, res as unknown as Response, () => {});
    expect(res.body).toEqual({
      error: 'Zu viele Aufgaben',
      errorCode: 'errors.bingo.minimumTasks',
      messageKey: 'errors.bingo.minimumTasks',
      params: { count: 3 },
    });
  });
});

describe('notFoundHandler', () => {
  it('responds with a 404 JSON body', () => {
    const res = makeRes();
    notFoundHandler({} as Request, res as unknown as Response);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({
      error: 'Not Found',
      errorCode: 'errors.notFound',
      messageKey: 'errors.notFound',
    });
  });
});

describe('errorHandler', () => {
  const next: NextFunction = () => {};
  const req = {} as Request;

  it('responds with the AppError status and message', () => {
    const res = makeRes();
    errorHandler(new AppError(400, 'Bad input'), req, res as unknown as Response, next);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Bad input' });
  });

  it('maps an AppError with a 5xx status to a 500 response', () => {
    const res = makeRes();
    errorHandler(new AppError(503, 'Unavailable'), req, res as unknown as Response, next);
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: 'Unavailable' });
  });

  it('responds with 500 for an unknown thrown error in production', () => {
    const res = makeRes();
    errorHandler(new Error('boom'), req, res as unknown as Response, next);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({
      error: 'Internal Server Error',
      errorCode: 'errors.internal',
      messageKey: 'errors.internal',
    });
  });
});
