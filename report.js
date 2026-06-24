function buildReport(db) {
  const companies = db.prepare(`SELECT * FROM companies WHERE status = 'submitted'`).all();
  const employees = db.prepare(`
    SELECT e.* FROM employees e
    JOIN companies c ON c.id = e.company_id
    WHERE c.status = 'submitted'
  `).all();

  const totalCompanies = companies.length;
  const totalEmployees = employees.length;

  const breakdown = (key) => {
    const counts = {};
    for (const e of employees) {
      const k = e[key] || 'Unspecified';
      counts[k] = (counts[k] || 0) + 1;
    }
    return counts;
  };

  const avg = (key) => {
    const vals = employees.map(e => e[key]).filter(v => v != null && v > 0);
    if (!vals.length) return 0;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  };

  const bySection = (section) => employees.filter(e => e.section === section);

  const earningsValues = employees.map(e => e.gross_earnings).filter(v => v > 0);
  const meanEarnings = avg('gross_earnings');
  const outliers = employees.filter(e =>
    e.gross_earnings > 0 && earningsValues.length > 1 &&
    Math.abs(e.gross_earnings - meanEarnings) > 2 * stdDev(earningsValues)
  );

  const summaryText = generateNarrativeSummary({
    totalCompanies, totalEmployees,
    sexBreakdown: breakdown('sex'),
    employmentTypeBreakdown: breakdown('employment_type'),
    nationalityBreakdown: breakdown('nationality'),
    avgHours: avg('hours_worked'),
    avgOvertime: avg('overtime_hours'),
    avgEarnings: meanEarnings,
    outlierCount: outliers.length,
  });

  return {
    totalCompanies,
    totalEmployees,
    weeklyCount: bySection('weekly').length,
    monthlyCount: bySection('monthly').length,
    sexBreakdown: breakdown('sex'),
    employmentTypeBreakdown: breakdown('employment_type'),
    nationalityBreakdown: breakdown('nationality'),
    occupationBreakdown: breakdown('occupation'),
    frontierWorkerCount: employees.filter(e => e.frontier_worker === 'Yes').length,
    detachedWorkerCount: employees.filter(e => e.detached_worker === 'Yes').length,
    avgHours: avg('hours_worked'),
    avgOvertime: avg('overtime_hours'),
    avgEarnings: meanEarnings,
    avgBenefits: avg('benefits_value'),
    outliers,
    summaryText,
    companies,
  };
}

function stdDev(values) {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Plain-stats narrative for now. To upgrade to an AI-generated narrative,
 * call the Claude API here with `stats` as context and return the model's
 * text instead. Needs an ANTHROPIC_API_KEY env var once you have one:
 *
 *   const Anthropic = require('@anthropic-ai/sdk');
 *   const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
 *   const msg = await client.messages.create({
 *     model: 'claude-sonnet-4-6',
 *     max_tokens: 800,
 *     messages: [{ role: 'user', content: `Summarize this employment survey data: ${JSON.stringify(stats)}` }],
 *   });
 *   return msg.content[0].text;
 */
function generateNarrativeSummary(stats) {
  const lines = [];
  lines.push(`${stats.totalCompanies} companies submitted responses, covering ${stats.totalEmployees} employees in total.`);

  const sexEntries = Object.entries(stats.sexBreakdown);
  if (sexEntries.length) {
    const parts = sexEntries.map(([k, v]) => `${k}: ${v}`).join(', ');
    lines.push(`Sex distribution — ${parts}.`);
  }

  const typeEntries = Object.entries(stats.employmentTypeBreakdown);
  if (typeEntries.length) {
    const parts = typeEntries.map(([k, v]) => `${k}: ${v}`).join(', ');
    lines.push(`Employment type — ${parts}.`);
  }

  const natEntries = Object.entries(stats.nationalityBreakdown).sort((a, b) => b[1] - a[1]);
  if (natEntries.length) {
    const top = natEntries.slice(0, 3).map(([k, v]) => `${k} (${v})`).join(', ');
    lines.push(`Most common nationalities: ${top}.`);
  }

  lines.push(`Average hours worked: ${stats.avgHours.toFixed(1)}, average overtime: ${stats.avgOvertime.toFixed(1)} hours.`);
  lines.push(`Average gross earnings: £${stats.avgEarnings.toFixed(2)}.`);

  if (stats.outlierCount > 0) {
    lines.push(`${stats.outlierCount} employee record(s) had gross earnings significantly outside the typical range and may warrant review.`);
  }

  return lines.join(' ');
}

module.exports = { buildReport };
