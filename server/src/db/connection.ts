import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;

export const pool = new Pool({
  connectionString,
  ssl: connectionString && !connectionString.includes('localhost')
    ? { rejectUnauthorized: false }
    : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

export async function query<T = any>(text: string, params?: any[]): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params);
}

export async function checkDbConnection(): Promise<{ healthy: boolean; error?: string }> {
  try {
    const res = await pool.query('SELECT 1 as connected');
    return { healthy: res.rows[0]?.connected === 1 };
  } catch (err: any) {
    return { healthy: false, error: err.message };
  }
}
