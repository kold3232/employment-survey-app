const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'survey.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT UNIQUE NOT NULL,
    contact_email TEXT NOT NULL,
    company_label TEXT,
    status TEXT NOT NULL DEFAULT 'pending', -- pending | submitted
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    submitted_at TEXT,

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
    submission_date TEXT
  );

  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    section TEXT NOT NULL, -- weekly | monthly
    sex TEXT,
    age_band TEXT,
    employment_type TEXT, -- full-time | part-time
    occupation TEXT,
    nationality TEXT,
    frontier_worker TEXT, -- Yes | No
    detached_worker TEXT, -- Yes | No
    hours_worked REAL,
    overtime_hours REAL,
    gross_earnings REAL,
    benefits_value REAL
  );
`);

module.exports = db;
