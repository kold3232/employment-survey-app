async function buildReport(db) {
  const companies = await db.all(`SELECT * FROM companies WHERE status = 'submitted'`);
  const employees = await db.all(`
    SELECT e.* FROM employees e
    JOIN companies c ON c.id = e.company_id
    WHERE c.status = 'submitted'
  `);

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

  const statsForSummary = {
    totalCompanies, totalEmployees,
    sexBreakdown: breakdown('sex'),
    employmentTypeBreakdown: breakdown('employment_type'),
    nationalityBreakdown: breakdown('nationality'),
    occupationBreakdown: breakdown('occupation'),
    avgHours: avg('hours_worked'),
    avgOvertime: avg('overtime_hours'),
    avgEarnings: meanEarnings,
    avgBenefits: avg('benefits_value'),
    outlierCount: outliers.length,
  };

  const summaryText = await generateNarrativeSummary(statsForSummary);

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

async function generateNarrativeSummary(stats) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    try {
      return await generateWithClaude(stats, apiKey);
    } catch (err) {
      console.error('Claude summary failed, falling back to plain stats:', err.message);
    }
  }
  return generatePlainStatsSummary(stats);
}

async function generateWithClaude(stats, apiKey) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `You are writing the executive summary section of an employment survey report. ` +
          `Write a concise, professional narrative (3-5 short paragraphs, no headers, no bullet points) ` +
          `summarizing the following aggregated survey statistics. Highlight notable patterns, ` +
          `any outliers, and what stands out about the workforce composition. Do not invent figures ` +
          `beyond what is given.\n\nStatistics (JSON):\n${JSON.stringify(stats, null, 2)}`,
      }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API ${response.status}: ${text}`);
  }

  const data = await response.json();
  return data.content[0].text.trim();
}

function generatePlainStatsSummary(stats) {
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
