const express = require('express');
const { nanoid } = require('nanoid');
const db = require('./db');
const { buildReport } = require('./report');
const mailer = require('./mailer');

const app = express();
app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname + '/public'));

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';

function requireAdmin(req, res, next) {
  const auth = req.headers.authorization;
  if (auth) {
    const [, encoded] = auth.split(' ');
    const [, password] = Buffer.from(encoded, 'base64').toString().split(':');
    if (password === ADMIN_PASSWORD) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Admin"');
  res.status(401).send('Authentication required');
}

function buildEmailContent(company) {
  const link = `${BASE_URL}/survey/${company.token}`;
  const subject = 'Employment Survey 2025 - Action Required';
  const body = [
    `Dear Sir/Madam,`,
    ``,
    `Please complete the Employment Survey 2025 using the secure link below.`,
    `This link is unique to your company - please do not share it.`,
    ``,
    link,
    ``,
    `If you have any queries please do not hesitate to contact us.`,
    ``,
    `Kind regards,`,
  ].join('\n');
  return { link, subject, body };
}

async function sendCompanyEmail(company) {
  const { subject, body } = buildEmailContent(company);
  try {
    await mailer.sendSurveyEmail({ to: company.contact_email, subject, text: body });
    db.prepare('UPDATE companies SET email_sent_at = datetime(\'now\'), email_send_error = NULL WHERE id = ?')
      .run(company.id);
    return { ok: true };
  } catch (err) {
    db.prepare('UPDATE companies SET email_send_error = ? WHERE id = ?').run(err.message, company.id);
    return { ok: false, error: err.message };
  }
}

function getSettings() {
  return db.prepare('SELECT * FROM settings WHERE id = 1').get();
}

// ---------- Admin dashboard ----------
app.get('/', requireAdmin, (req, res) => {
  const companies = db.prepare(
    'SELECT * FROM companies ORDER BY created_at DESC'
  ).all();
  res.render('admin', {
    companies,
    baseUrl: BASE_URL,
    bulkAdded: req.query.bulk_added ?? null,
    bulkSkipped: req.query.bulk_skipped ?? null,
    emailConfigured: mailer.isConfigured(),
    settings: getSettings(),
    sendResult: req.query.send_result ?? null,
    sent: req.query.sent ?? null,
    failed: req.query.failed ?? null,
  });
});

app.post('/admin/schedule', requireAdmin, (req, res) => {
  const { scheduled_send_at } = req.body;
  db.prepare('UPDATE settings SET scheduled_send_at = ? WHERE id = 1')
    .run(scheduled_send_at ? scheduled_send_at : null);
  res.redirect('/');
});

app.post('/admin/companies/:id/send', requireAdmin, async (req, res) => {
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  if (!company) return res.status(404).send('Not found');
  const result = await sendCompanyEmail(company);
  res.redirect(`/?send_result=${result.ok ? 'ok' : 'fail'}`);
});

app.post('/admin/companies/send-all', requireAdmin, async (req, res) => {
  const pending = db.prepare(
    `SELECT * FROM companies WHERE status = 'pending' AND email_sent_at IS NULL`
  ).all();
  let sent = 0, failed = 0;
  for (const company of pending) {
    const result = await sendCompanyEmail(company);
    if (result.ok) sent++; else failed++;
  }
  res.redirect(`/?send_result=batch&sent=${sent}&failed=${failed}`);
});

app.post('/admin/companies', requireAdmin, (req, res) => {
  const { contact_email, company_label } = req.body;
  if (!contact_email) return res.redirect('/');
  const token = nanoid(12);
  db.prepare(
    'INSERT INTO companies (token, contact_email, company_label) VALUES (?, ?, ?)'
  ).run(token, contact_email.trim(), (company_label || '').trim());
  res.redirect('/');
});

app.post('/admin/companies/bulk', requireAdmin, (req, res) => {
  const { bulk_input } = req.body;
  if (!bulk_input) return res.redirect('/');

  const insert = db.prepare(
    'INSERT INTO companies (token, contact_email, company_label) VALUES (?, ?, ?)'
  );
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  let added = 0;
  let skipped = 0;

  for (const rawLine of bulk_input.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const [emailPart, ...labelParts] = line.split(',');
    const email = (emailPart || '').trim();
    const label = labelParts.join(',').trim();
    if (!emailRe.test(email)) { skipped++; continue; }
    insert.run(nanoid(12), email, label);
    added++;
  }

  res.redirect(`/?bulk_added=${added}&bulk_skipped=${skipped}`);
});

app.post('/admin/companies/:id/delete', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM companies WHERE id = ?').run(req.params.id);
  res.redirect('/');
});

app.get('/admin/companies/:id/email-preview', requireAdmin, (req, res) => {
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  if (!company) return res.status(404).send('Not found');
  const { link, subject, body } = buildEmailContent(company);
  res.render('email-preview', { company, link, subject, body, emailConfigured: mailer.isConfigured() });
});

// ---------- Scheduled send trigger (called by an external cron pinger) ----------
app.all('/cron/send-scheduled', async (req, res) => {
  const secret = req.query.secret || req.headers['x-cron-secret'];
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(401).send('Unauthorized');
  }

  const settings = getSettings();
  if (!settings.scheduled_send_at) {
    return res.json({ fired: false, reason: 'no scheduled_send_at set' });
  }
  if (new Date(settings.scheduled_send_at) > new Date()) {
    return res.json({ fired: false, reason: 'scheduled time not reached yet' });
  }

  const pending = db.prepare(
    `SELECT * FROM companies WHERE status = 'pending' AND email_sent_at IS NULL`
  ).all();

  let sent = 0, failed = 0;
  for (const company of pending) {
    const result = await sendCompanyEmail(company);
    if (result.ok) sent++; else failed++;
  }

  res.json({ fired: true, sent, failed });
});

app.get('/report', requireAdmin, async (req, res) => {
  const report = await buildReport(db);
  res.render('report', { report });
});

// ---------- Public survey ----------
app.get('/survey/:token', (req, res) => {
  const company = db.prepare('SELECT * FROM companies WHERE token = ?').get(req.params.token);
  if (!company) return res.status(404).send('Survey link not found or expired.');
  res.render('survey', { company });
});

app.post('/survey/:token', (req, res) => {
  const company = db.prepare('SELECT * FROM companies WHERE token = ?').get(req.params.token);
  if (!company) return res.status(404).send('Survey link not found or expired.');

  const b = req.body;

  db.prepare(`
    UPDATE companies SET
      registered_name = ?, trading_as = ?, address = ?, tel = ?, fax = ?, email = ?,
      main_goods_services = ?, other_info = ?, contact_name = ?, contact_position = ?,
      submission_date = ?, status = 'submitted', submitted_at = datetime('now')
    WHERE id = ?
  `).run(
    b.registered_name || '', b.trading_as || '', b.address || '', b.tel || '', b.fax || '',
    b.email || '', b.main_goods_services || '', b.other_info || '', b.contact_name || '',
    b.contact_position || '', b.submission_date || '', company.id
  );

  // clear previous employee rows for this company (in case of resubmission)
  db.prepare('DELETE FROM employees WHERE company_id = ?').run(company.id);

  const insertEmp = db.prepare(`
    INSERT INTO employees (
      company_id, section, sex, age_band, employment_type, occupation, nationality,
      frontier_worker, detached_worker, hours_worked, overtime_hours, gross_earnings, benefits_value
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const section of ['weekly', 'monthly']) {
    const rows = parseEmployeeRows(b, section);
    for (const row of rows) {
      insertEmp.run(
        company.id, section, row.sex, row.age_band, row.employment_type, row.occupation,
        row.nationality, row.frontier_worker, row.detached_worker, row.hours_worked,
        row.overtime_hours, row.gross_earnings, row.benefits_value
      );
    }
  }

  res.render('survey-thanks', { company });
});

function parseEmployeeRows(body, section) {
  // Form fields are named like weekly_sex[], weekly_age_band[], etc. — arrays aligned by index.
  const fields = [
    'sex', 'age_band', 'employment_type', 'occupation', 'nationality',
    'frontier_worker', 'detached_worker', 'hours_worked', 'overtime_hours',
    'gross_earnings', 'benefits_value'
  ];
  const arrays = {};
  let length = 0;
  for (const f of fields) {
    const key = `${section}_${f}`;
    let val = body[key];
    if (val === undefined) val = [];
    if (!Array.isArray(val)) val = [val];
    arrays[f] = val;
    length = Math.max(length, val.length);
  }
  const rows = [];
  for (let i = 0; i < length; i++) {
    const occupation = (arrays.occupation[i] || '').trim();
    if (!occupation) continue; // skip empty rows
    rows.push({
      sex: arrays.sex[i] || '',
      age_band: arrays.age_band[i] || '',
      employment_type: arrays.employment_type[i] || '',
      occupation,
      nationality: arrays.nationality[i] || '',
      frontier_worker: arrays.frontier_worker[i] || 'No',
      detached_worker: arrays.detached_worker[i] || 'No',
      hours_worked: parseFloat(arrays.hours_worked[i]) || 0,
      overtime_hours: parseFloat(arrays.overtime_hours[i]) || 0,
      gross_earnings: parseFloat(arrays.gross_earnings[i]) || 0,
      benefits_value: parseFloat(arrays.benefits_value[i]) || 0,
    });
  }
  return rows;
}

app.listen(PORT, () => {
  console.log(`Employment Survey app running at ${BASE_URL}`);
});
