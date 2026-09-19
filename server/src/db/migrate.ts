import { pool } from './connection.js';
import { SCHEMA_DDL } from './schema.js';

export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(SCHEMA_DDL);
    await client.query('COMMIT');
    console.log('✓ Database migrations applied successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('✕ Migration failed:', err);
    throw err;
  } finally {
    client.release();
  }
}

// If run directly via node / tsx
if (process.argv[1] && process.argv[1].includes('migrate')) {
  runMigrations()
    .then(() => {
      console.log('Done.');
      process.exit(0);
    })
    .catch(() => process.exit(1));
}
