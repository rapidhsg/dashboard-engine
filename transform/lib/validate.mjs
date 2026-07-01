// Validation gate. Returns { ok, errors }. If not ok, the caller must NOT publish —
// it keeps the last-good JSON and sends an alert. Stale-but-correct beats wrong.

// Minimum sane row counts per report (a healthy account is far above these).
const MIN_ROWS = {
  completed_jobs: 40,
  sales_revenue: 20,
  revenue_in_progress: 0, // can legitimately be a handful
  leads_by_source: 100,
  sits_tev: 40,
};

// Columns each report MUST contain. Catches Acculynx schema changes (a renamed/removed
// column would otherwise silently compute to 0). This replaces the old ">0" check, which
// wrongly blocked legitimate quarter-start data (QTD is naturally 0 on day 1 of a quarter).
const REQUIRED_COLS = {
  completed_jobs: ["Current Milestone", "Completed Milestone Date", "Contract Amount", "Work Type"],
  sales_revenue: ["Contract Amount", "Approved Date", "Work Type", "Primary Salesperson"],
  revenue_in_progress: ["Job Value"],
  leads_by_source: ["Lead Milestone Date"],
  sits_tev: ["Initial Appointment Date", "Primary Estimate Amount", "Primary Salesperson", "Appointment Set By", "Current Milestone", "Job Value"],
};

const finite = (n) => typeof n === "number" && Number.isFinite(n);

export function validate({ rows, rr1Data, rr2Data, runDates }, config) {
  const errors = [];

  // 1. All reports present, parsed, and not suspiciously short.
  for (const name of Object.keys(config.reports)) {
    const r = rows[name];
    if (!Array.isArray(r)) {
      errors.push(`report "${name}" missing or failed to parse`);
      continue;
    }
    const min = MIN_ROWS[name] ?? 0;
    if (r.length < min) errors.push(`report "${name}" has ${r.length} rows (< ${min})`);
    // schema check: required columns must be present
    if (r.length > 0) {
      for (const col of REQUIRED_COLS[name] || []) {
        if (!(col in r[0])) errors.push(`report "${name}" is missing expected column "${col}"`);
      }
    }
  }

  // 2. Freshness — every report's run must be within ~2 days.
  if (runDates) {
    const now = Date.now();
    for (const [name, iso] of Object.entries(runDates)) {
      const t = Date.parse(iso);
      if (!Number.isFinite(t)) errors.push(`report "${name}" has unparseable run date`);
      else if (now - t > 2 * 86400000) errors.push(`report "${name}" run is stale (${iso})`);
    }
  }

  // 3. rr1 — every metric is a finite number and has a goal. (No ">0" rule: quarter-to-date
  //    is legitimately 0 at the start of a quarter. Empty/broken reports are caught by the
  //    row-count + required-column checks above.)
  const r1 = rr1Data && rr1Data.metrics;
  if (!Array.isArray(r1) || r1.length !== config.rr1Metrics.length) {
    errors.push("rr1 metrics malformed");
  } else {
    for (const m of r1) {
      if (!finite(m.actual)) errors.push(`rr1 "${m.key}" actual is not a number`);
      if (!finite(m.goal) || m.goal <= 0) errors.push(`rr1 "${m.key}" goal missing/invalid`);
    }
  }

  // 4. rr2 — team has activity; reps numeric.
  if (!rr2Data || !rr2Data.team) errors.push("rr2 team missing");
  else {
    if (!(rr2Data.team.demos > 0)) errors.push("rr2 team demos is 0");
    if (!(rr2Data.team.sold > 0)) errors.push("rr2 team sold is 0");
    for (const rep of rr2Data.reps || []) {
      if (!finite(rep.demos) || !finite(rep.soldDollars))
        errors.push(`rr2 rep "${rep.name}" has non-numeric stats`);
    }
  }

  return { ok: errors.length === 0, errors };
}
