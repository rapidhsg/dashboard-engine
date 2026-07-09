// Calibrated rr1 + rr2 computation. Pure functions over parsed CSV rows.
// Formulas validated to-the-dollar against the Jun-12 dashboard snapshot.

// ---------- helpers ----------
export function parseMoney(s) {
  if (s == null) return 0;
  const v = String(s).replace(/[$,]/g, "").trim();
  if (v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Acculynx dates look like "6/11/26" or "6/11/2026" optionally followed by a time.
// Returns "YYYY-MM-DD" (string comparison-safe) or null.
export function toYmd(s) {
  if (!s) return null;
  const first = String(s).trim().split(/\s+/)[0];
  const m = first.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  let [, mo, d, y] = m;
  y = y.length === 2 ? "20" + y : y;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

// Quarter for a "YYYY-MM-DD" run date.
export function quarterFor(runYmd) {
  const [y, mo] = runYmd.split("-").map(Number);
  const q = Math.floor((mo - 1) / 3) + 1; // 1..4
  const startMo = (q - 1) * 3 + 1;
  const endMo = startMo + 2;
  const lastDay = new Date(Date.UTC(y, endMo, 0)).getUTCDate(); // day 0 of next month
  const pad = (n) => String(n).padStart(2, "0");
  return {
    label: `Q${q} ${y}`,
    startDate: `${y}-${pad(startMo)}-01`,
    endDate: `${y}-${pad(endMo)}-${pad(lastDay)}`,
  };
}

// runYmd minus N days -> "YYYY-MM-DD" (matches the dashboards' setDate(getDate()-90)).
export function minusDays(runYmd, days) {
  const [y, m, d] = runYmd.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) - days * 86400000;
  const dt = new Date(t);
  const pad = (n) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

const inRange = (ymd, lo, hi) => ymd != null && ymd >= lo && ymd <= hi;
const round = (n) => Math.round(n);

// ---------- rr1 ----------
export function computeRr1(rows, runYmd, goals, config) {
  const q = quarterFor(runYmd);
  const lo = q.startDate;
  const hi = runYmd; // quarter-to-date through the run date

  const sr = rows.sales_revenue || [];
  const cj = rows.completed_jobs || [];
  const rip = rows.revenue_in_progress || [];
  const lb = rows.leads_by_source || [];
  const st = rows.sits_tev || [];

  const apprInQ = sr.filter((r) => inRange(toYmd(r["Approved Date"]), lo, hi));
  const compInQ = cj.filter((r) => inRange(toYmd(r["Completed Milestone Date"]), lo, hi));

  const actuals = {
    sales: round(
      apprInQ
        .filter((r) => config.salesWorkTypes.includes(r["Work Type"]))
        .reduce((s, r) => s + parseMoney(r["Contract Amount"]), 0)
    ),
    in_progress: round(rip.reduce((s, r) => s + parseMoney(r["Job Value"]), 0)),
    revenue: round(compInQ.reduce((s, r) => s + parseMoney(r["Contract Amount"]), 0)),
    // Upsells = INSTALLED basis (Completed Jobs completed-in-quarter, per CEO), not approved.
    upsells: round(
      compInQ
        .filter((r) => r["Work Type"] === config.upsellWorkType)
        .reduce((s, r) => s + parseMoney(r["Contract Amount"]), 0)
    ),
    leads: lb.filter((r) => inRange(toYmd(r["Lead Milestone Date"]), lo, hi)).length,
    sits: st.filter((r) => inRange(toYmd(r["Initial Appointment Date"]), lo, hi)).length,
    // Total Jobs Installed = real installs: completed-in-quarter, excl Upsell, and Contract > 0
    // (drops $0 call-backs/warranty jobs, per CEO — matches his "Total Jobs" number).
    jobs: compInQ.filter(
      (r) => r["Work Type"] !== config.upsellWorkType && parseMoney(r["Contract Amount"]) > 0
    ).length,
  };

  const metrics = config.rr1Metrics.map((m) => ({
    ...m,
    actual: actuals[m.key],
    goal: goals[m.key],
  }));

  return {
    quarter: { ...q, refreshDate: runYmd },
    metrics,
  };
}

// ---------- rr2 ----------
export function computeRr2(rows, runYmd, config) {
  const q = quarterFor(runYmd);
  const lo = minusDays(runYmd, config.rollingWindowDays); // rolling-90 start
  const hi = runYmd;

  const sr = rows.sales_revenue || [];
  const st = rows.sits_tev || [];

  const inWin = (ymd) => inRange(ymd, lo, hi);
  const estPos = (r) => parseMoney(r["Primary Estimate Amount"]) > 0;

  const reps = config.reps.map((rep) => {
    const demos = st.filter(
      (r) =>
        r["Primary Salesperson"] === rep.fullName &&
        inWin(toYmd(r["Initial Appointment Date"])) &&
        estPos(r)
    ).length;
    const soldRows = sr.filter(
      (r) => r["Primary Salesperson"] === rep.fullName && inWin(toYmd(r["Approved Date"]))
    );
    const sold = soldRows.length;
    const soldDollars = round(soldRows.reduce((s, r) => s + parseMoney(r["Contract Amount"]), 0));
    return {
      name: rep.fullName,
      short: rep.short,
      role: rep.role,
      demos,
      sold,
      soldDollars,
      closeRate: demos ? +((100 * sold) / demos).toFixed(1) : 0,
      revPerSit: demos ? round(soldDollars / demos) : 0,
    };
  });

  const tDemos = reps.reduce((s, r) => s + r.demos, 0);
  const tSold = reps.reduce((s, r) => s + r.sold, 0);
  const tDollars = reps.reduce((s, r) => s + r.soldDollars, 0);
  const team = {
    demos: tDemos,
    sold: tSold,
    soldDollars: tDollars,
    closeRate: tDemos ? +((100 * tSold) / tDemos).toFixed(1) : 0,
    revPerSit: tDemos ? round(tDollars / tDemos) : 0,
  };

  // Setters: show EVERY distinct "Appointment Set By" in the window, EXCEPT the excluded junk
  // buckets (config.setterExclude — e.g. Other, N/A, Bryan, Janet-left) and blanks. New CSRs
  // (like Marco) auto-appear without a code change.
  const excluded = new Set((config.setterExclude || []).map((x) => x.toLowerCase()));
  const winSits = st.filter((r) => inWin(toYmd(r["Initial Appointment Date"])));
  const setterNames = [...new Set(winSits.map((r) => (r["Appointment Set By"] || "").trim()))].filter(
    (n) => n && !excluded.has(n.toLowerCase())
  );
  const setters = setterNames
    .map((name) => {
      const set = winSits.filter((r) => (r["Appointment Set By"] || "").trim() === name);
      const soldRows = set.filter((r) => config.soldMilestones.includes(r["Current Milestone"]));
      const soldDollars = round(soldRows.reduce((s, r) => s + parseMoney(r["Job Value"]), 0));
      return {
        name: name.toUpperCase(),
        role: "APPT SETTER",
        apptsSet: set.length,
        sold: soldRows.length,
        soldDollars,
        conversion: set.length ? +((100 * soldRows.length) / set.length).toFixed(1) : 0,
      };
    })
    .sort((a, b) => b.soldDollars - a.soldDollars);

  return {
    quarter: { ...q, refreshDate: runYmd },
    team,
    reps,
    setters,
  };
}
