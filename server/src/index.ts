import dotenv from 'dotenv';
import { buildApp } from './app.js';
import { runMigrations } from './db/migrate.js';

dotenv.config();

const port = Number(process.env.PORT) || 4000;
const host = '0.0.0.0';

async function start() {
  // 1. Run migrations if DATABASE_URL is set
  if (process.env.DATABASE_URL) {
    try {
      console.log('Running database migrations...');
      await runMigrations();
    } catch (err: any) {
      console.error('Migration error on startup:', err.message);
    }
  } else {
    console.warn('⚠️  DATABASE_URL not set; skipping automatic migrations.');
  }

  // 2. Start server
  const app = buildApp();
  try {
    const address = await app.listen({ port, host });
    console.log(`✓ ZIMBI API server listening on ${address}`);
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
