import 'dotenv/config';
import { runMigrations } from '../server/migrations.ts';

// Standalone migration runner. Applies the declarative schema diff and data
// migrations to the configured database (DB_PATH) and exits.
//
// Used by the deploy script to bring the database up to date BEFORE the build
// step, because the build itself (buildVersion.ts) already reads tables that
// may have been changed by new migrations.
runMigrations();
console.log('Database migrations applied');
