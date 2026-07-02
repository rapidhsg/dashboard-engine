// Acculynx scheduled-report pull chain (zero deps; uses global fetch, Node 18+).
//   runs/latest -> recipients -> download fileUrl
// Returns raw CSV text per report. Retries transient failures with backoff,
// staying well under the 10 req/s API limit.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, apiKey, { retries = 4 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      });
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`HTTP ${res.status} on ${url}`);
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status} on ${url} :: ${body.slice(0, 200)}`);
      }
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(500 * Math.pow(2, attempt)); // 0.5s,1s,2s,4s
    }
  }
  throw lastErr;
}

async function getText(url, { retries = 4 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url); // signed temp URL, no auth
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} downloading file`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(500 * Math.pow(2, attempt));
    }
  }
  throw lastErr;
}

// Pull one scheduled report's latest CSV text.
export async function pullReport(baseUrl, apiKey, scheduledReportId) {
  const latest = await getJson(
    `${baseUrl}/reports/scheduled-reports/${scheduledReportId}/runs/latest`,
    apiKey
  );
  const runId = latest && latest.runInstanceId;
  if (!runId) throw new Error(`No latest run for report ${scheduledReportId}`);

  const recips = await getJson(
    `${baseUrl}/reports/scheduled-reports/${scheduledReportId}/runs/${runId}/recipients`,
    apiKey
  );
  const fileUrl =
    recips &&
    recips.items &&
    recips.items[0] &&
    recips.items[0].files &&
    recips.items[0].files[0] &&
    recips.items[0].files[0].fileUrl;
  if (!fileUrl) throw new Error(`No file URL for report ${scheduledReportId}`);

  const csv = await getText(fileUrl);
  return { csv, runDate: latest.date, fileUrl };
}

// Map a delivered filename to a report key by its stable prefix.
// e.g. "sales_revenue_report_pace_raw_7_2_2026_...csv" -> "sales_revenue"
const FILE_PREFIX = {
  completed_jobs: "completed_jobs",
  sales_revenue: "sales_revenue",
  revenue_in_progress: "revenue_in_progress",
  leads_by_source: "leads_by_source",
  sits_tev: "sits_tev",
};
function reportKeyForFilename(name) {
  const n = (name || "").toLowerCase();
  for (const [key, prefix] of Object.entries(FILE_PREFIX)) {
    if (n.startsWith(prefix)) return key;
  }
  return null;
}

// Get a schedule's latest run's files as [{reportKey, fileUrl, runDate}].
// Returns [] if the schedule has no run yet (new/unfired) — never throws for that.
async function latestScheduleFiles(baseUrl, apiKey, scheduleId) {
  let latest;
  try {
    latest = await getJson(
      `${baseUrl}/reports/scheduled-reports/${scheduleId}/runs/latest`,
      apiKey,
      { retries: 2 }
    );
  } catch {
    return []; // 404 = hasn't run yet
  }
  const runId = latest && latest.runInstanceId;
  if (!runId) return [];
  const recips = await getJson(
    `${baseUrl}/reports/scheduled-reports/${scheduleId}/runs/${runId}/recipients`,
    apiKey
  );
  const out = [];
  for (const it of (recips && recips.items) || []) {
    for (const f of it.files || []) {
      const name = (f.fileUrl || "").split("/").pop();
      const key = reportKeyForFilename(name);
      if (key && f.fileUrl) out.push({ reportKey: key, fileUrl: f.fileUrl, runDate: latest.date, name });
    }
  }
  return out;
}

// Pull the FRESHEST copy of each report across all schedules:
//   config.bundledScheduleIds (each delivers all 5) + config.reports (single-report fallbacks).
// For every report key, the file from the most recent run wins. Returns { name: { csv, runDate } }.
export async function pullAll(config, apiKey) {
  const base = config.acculynxBaseUrl;
  const scheduleIds = [
    ...(config.bundledScheduleIds || []),
    ...Object.values(config.reports || {}),
  ];

  const best = {}; // reportKey -> {fileUrl, runDate, name}
  for (const sid of scheduleIds) {
    const files = await latestScheduleFiles(base, apiKey, sid);
    for (const f of files) {
      const cur = best[f.reportKey];
      if (!cur || String(f.runDate) > String(cur.runDate)) best[f.reportKey] = f;
    }
  }

  const out = {};
  for (const key of Object.keys(config.reports || {})) {
    const c = best[key];
    if (!c) throw new Error(`No file found for report "${key}" across any schedule`);
    out[key] = { csv: await getText(c.fileUrl), runDate: c.runDate, fileUrl: c.fileUrl };
  }
  return out;
}
