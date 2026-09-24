import 'dotenv/config';
import { runMigrations } from '../server/migrations.js';

// Standalone migration runner used by the immutable release deployment.
// Production startup skips migrations; the deploy transaction runs this
// compiled script before switching the current release symlink.
runMigrations();
console.log('Database migrations applied');
