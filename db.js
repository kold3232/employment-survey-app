const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Add a Postgres connection string as an environment variable.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
});

// Accepts '?' placeholders (like the rest of this codebase used to write for SQLite)
// and converts them to Postgres-style $1, $2, ... placeholders.
function toPgQuery(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

async function all(sql, params = []) {
  const { rows } = await pool.query(toPgQuery(sql), params);
  return rows;
}

async function get(sql, params = []) {
  const { rows } = await pool.query(toPgQuery(sql), params);
  return rows[0];
}

async function run(sql, params = []) {
  const result = await pool.query(toPgQuery(sql), params);
  return { rowCount: result.rowCount };
}

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS companies (
      id SERIAL PRIMARY KEY,
      token TEXT UNIQUE NOT NULL,
      contact_email TEXT NOT NULL,
      company_label TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      submitted_at TIMESTAMPTZ,

      registered_name TEXT,
      trading_as TEXT,
      address TEXT,
      tel TEXT,
      fax TEXT,
      email TEXT,
      main_goods_services TEXT,
      other_info TEXT,
      contact_name TEXT,
      contact_position TEXT,
      submission_date TEXT,

      email_sent_at TIMESTAMPTZ,
      email_send_error TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      scheduled_send_at TEXT
    );
    INSERT INTO settings (id, scheduled_send_at) VALUES (1, NULL) ON CONFLICT (id) DO NOTHING;

    CREATE TABLE IF NOT EXISTS employees (
      id SERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      section TEXT NOT NULL,
      sex TEXT,
      age_band TEXT,
      employment_type TEXT,
      occupation TEXT,
      nationality TEXT,
      frontier_worker TEXT,
      detached_worker TEXT,
      hours_worked REAL,
      overtime_hours REAL,
      gross_earnings REAL,
      benefits_value REAL
    );
  `);
}

module.exports = { all, get, run, init, pool };
