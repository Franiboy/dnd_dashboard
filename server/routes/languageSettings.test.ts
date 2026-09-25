import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import cookieParser from 'cookie-parser';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SafeUser } from '../../shared/types.js';
import { createToken } from '../auth.js';
import { errorHandler, notFoundHandler } from '../errors.js';
import { setAiLanguageSettings } from '../repositories/aiSettings.js';
import {
  createDiscordUser,
  findUserById,
  setUserAdmin,
  setUserUiLanguage,
} from '../repositories/users.js';
import adminRouter from './admin.js';
import authRouter from './auth.js';

const suffix = randomUUID();
const regularUser = createDiscordUser(
  `discord-language-api-${suffix}`,
  `language-api-${suffix}`,
  'Language API User',
  null
);
const adminUser = createDiscordUser(
  `discord-language-admin-${suffix}`,
  `language-admin-${suffix}`,
  'Language API Admin',
  null
);
setUserAdmin(adminUser.id, true);

const regularToken = createToken(findUserById(regularUser.id)!);
const adminToken = createToken(findUserById(adminUser.id)!);

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api', authRouter);
app.use('/api/admin', adminRouter);
app.use(notFoundHandler);
app.use(errorHandler);

let server: Server;
let baseUrl: string;

async function request<T>(
  path: string,
  options: { token?: string; method?: string; body?: unknown } = {}
): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return { status: response.status, body: (await response.json()) as T };
}

function userBody(user: SafeUser): { ok: true; user: SafeUser } {
  return { ok: true, user };
}

beforeAll(async () => {
  server = await new Promise<Server>((resolve) => {
    const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer));
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  setUserUiLanguage(regularUser.id, null);
  setAiLanguageSettings('de');
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

describe('PUT /api/me/ui-language', () => {
  it('requires authentication', async () => {
    const result = await request<{ error: string }>('/api/me/ui-language', {
      method: 'PUT',
      body: { language: 'en' },
    });

    expect(result.status).toBe(401);
  });

  it('stores supported languages and automatic selection', async () => {
    const german = await request<{ ok: true; user: SafeUser }>('/api/me/ui-language', {
      token: regularToken,
      method: 'PUT',
      body: { language: 'de' },
    });
    expect(german.status).toBe(200);
    expect(german.body.user.uiLanguage).toBe('de');

    const english = await request<{ ok: true; user: SafeUser }>('/api/me/ui-language', {
      token: regularToken,
      method: 'PUT',
      body: { language: 'en' },
    });
    expect(english.status).toBe(200);
    expect(english.body.user.uiLanguage).toBe('en');

    const automatic = await request<{ ok: true; user: SafeUser }>('/api/me/ui-language', {
      token: regularToken,
      method: 'PUT',
      body: { language: null },
    });
    expect(automatic.status).toBe(200);
    expect(automatic.body).toEqual(userBody(regularUser));
    expect(findUserById(regularUser.id)?.uiLanguage).toBeNull();
  });

  it('rejects unsupported languages without changing the stored value', async () => {
    const result = await request<{ error: string }>('/api/me/ui-language', {
      token: regularToken,
      method: 'PUT',
      body: { language: 'fr' },
    });

    expect(result.status).toBe(400);
    expect(findUserById(regularUser.id)?.uiLanguage).toBeNull();
  });
});

describe('PUT /api/me/theme', () => {
  it('returns a localizable error for a wrong value type', async () => {
    const result = await request<{ errorCode?: string; messageKey?: string }>('/api/me/theme', {
      token: regularToken,
      method: 'PUT',
      body: { primary: 42 },
    });

    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({
      errorCode: 'errors.validation.color',
      messageKey: 'errors.validation.color',
    });
  });
});

describe('/api/admin/ai/language', () => {
  it('is restricted to admins', async () => {
    const response = await request<{ error: string }>('/api/admin/ai/language', {
      token: regularToken,
    });

    expect(response.status).toBe(403);
  });

  it('reads and updates the global language', async () => {
    const initial = await request<{ language: 'de' | 'en' }>('/api/admin/ai/language', {
      token: adminToken,
    });
    expect(initial).toEqual({ status: 200, body: { language: 'de' } });

    const updated = await request<{ language: 'de' | 'en' }>('/api/admin/ai/language', {
      token: adminToken,
      method: 'PUT',
      body: { language: 'en' },
    });
    expect(updated).toEqual({ status: 200, body: { language: 'en' } });
  });

  it('rejects null and unsupported languages', async () => {
    for (const language of [null, 'fr']) {
      const response = await request<{ error: string }>('/api/admin/ai/language', {
        token: adminToken,
        method: 'PUT',
        body: { language },
      });
      expect(response.status).toBe(400);
    }

    const current = await request<{ language: 'de' | 'en' }>('/api/admin/ai/language', {
      token: adminToken,
    });
    expect(current.body.language).toBe('de');
  });
});
