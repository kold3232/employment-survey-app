const nodemailer = require('nodemailer');

function isConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransport() {
  if (!isConfigured()) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE || 'true') === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendSurveyEmail({ to, subject, text }) {
  const transport = getTransport();
  if (!transport) {
    throw new Error('Email is not configured (missing SMTP_HOST / SMTP_USER / SMTP_PASS).');
  }
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  await transport.sendMail({ from, to, subject, text });
}

module.exports = { isConfigured, sendSurveyEmail };
