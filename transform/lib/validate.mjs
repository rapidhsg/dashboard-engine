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

  // 3. rr1 — every metric numeric; the must-be-positive ones are positive; goals set.
  const r1 = rr1Data && rr1Data.metrics;
  if (!Array.isArray(r1) || r1.length !== config.rr1Metrics.length) {
    errors.push("rr1 metrics malformed");
  } else {
    for (const m of r1) {
      if (!finite(m.actual)) errors.push(`rr1 "${m.key}" actual is not a number`);
      if (!finite(m.goal) || m.goal <= 0) errors.push(`rr1 "${m.key}" goal missing/invalid`);
    }
    const need = ["sales", "revenue", "upsells", "leads", "sits", "jobs"];
    for (const k of need) {
      const m = r1.find((x) => x.key === k);
      if (m && m.actual <= 0) errors.push(`rr1 "${k}" actual is ${m.actual} (expected > 0)`);
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
