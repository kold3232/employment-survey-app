function isConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

async function sendSurveyEmail({ to, subject, text }) {
  if (!isConfigured()) {
    throw new Error('Email is not configured (missing RESEND_API_KEY).');
  }
  const from = process.env.RESEND_FROM || 'onboarding@resend.dev';

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({ from, to, subject, text }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend API ${response.status}: ${body}`);
  }
}

module.exports = { isConfigured, sendSurveyEmail };
