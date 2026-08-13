import { randomBytes } from 'node:crypto';
import { defineConfig } from 'vitest/config';

// Ensure server modules that read environment at import time get safe test values.
process.env.JWT_SECRET ||= 'test-jwt-secret-32-chars-long!';
process.env.TOKEN_ENCRYPTION_KEY ||= randomBytes(32).toString('base64');
process.env.ADMIN_PASSWORD ||= 'test-admin-password';
process.env.DB_PATH ||= ':memory:';
process.env.NODE_ENV ||= 'test';
process.env.LOG_RETENTION_MAX ||= '100';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'server',
          environment: 'node',
          include: ['server/**/*.test.ts'],
          setupFiles: ['./server/vitest.setup.ts'],
          pool: 'forks',
        },
      },
      {
        test: {
          name: 'client',
          environment: 'jsdom',
          include: ['src/**/*.test.{ts,tsx}'],
          setupFiles: ['./src/vitest.setup.ts'],
        },
      },
    ],
  },
});
