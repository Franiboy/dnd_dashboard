# Conventions

- TypeScript strict mode is active (`strict: true` in all `tsconfig.*.json`).
- Client code lives in `src/`, server code in `server/`, shared types in `shared/`.
- Server imports use `.js` suffixes (ESM / NodeNext).
- Client imports do not use `.js` suffixes and can import `.ts`/`.tsx` directly.
- `tsconfig.json` only contains project references (`tsconfig.app.json`, `tsconfig.node.json`).
- `tsconfig.server.json` builds `server/` and `shared/` to `dist-server/`.
- `scripts/buildVersion.ts` generates `dist-server/version.json` with the active feature flags.
- `scripts/copyServerAssets.ts` copies non-TS files to `dist-server/`.
- `server/version.ts` returns the active feature flags at runtime.
- The SQLite handle is opened centrally in `server/database.ts`.
- `dnd.db` and `dnd_test.db` are `.gitignore`d and created automatically.
- Environment variables are loaded via `dotenv` from `.env`.
- In production Express serves `dist/` and `trust proxy` is active.
- Feature flags (`aiEnabled`, `recordingEnabled`) are determined from `.env` and `version.ts`.
- New "apps" are maintained centrally in `src/lib/apps.ts` and used via the exported `isAppVisible()` helper in `AppSwitcher`, `Home` and `ProtectedRoute` so `disabledApps`, `adminOnly`, `hideForInitialAdmin` and `requiresFeature` are checked consistently everywhere.
- Routes that require a feature flag (`requiresFeature`) use `ProtectedRoute` with `appId` and `version` and show a loading state while `/api/version` is loading.
