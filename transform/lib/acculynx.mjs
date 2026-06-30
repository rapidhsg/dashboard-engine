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

// Pull all reports defined in config.reports. Returns { name: { csv, runDate } }.
// Runs sequentially to stay gentle on the rate limit (5 reports total).
export async function pullAll(config, apiKey) {
  const out = {};
  for (const [name, id] of Object.entries(config.reports)) {
    out[name] = await pullReport(config.acculynxBaseUrl, apiKey, id);
  }
  return out;
}
