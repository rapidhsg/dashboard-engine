// Entry point: pull 5 Acculynx CSVs -> parse -> compute rr1/rr2 -> validate ->
// write rr1-data.json / rr2-data.json (ONLY on success). On any failure it writes
// nothing (dashboards keep last-good JSON) and emails an alert.
//
// Env: ACCULYNX_API_KEY (required), RESEND_API_KEY (alerts), OUTPUT_DIR (default cwd).

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCsv } from "./lib/csv.mjs";
import { pullAll } from "./lib/acculynx.mjs";
import { computeRr1, computeRr2, quarterFor } from "./lib/compute.mjs";
import { validate } from "./lib/validate.mjs";
import { sendAlert } from "./lib/alert.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

const config = readJson(join(here, "config.json"));
const goalsAll = readJson(join(here, "goals.json"));
const API_KEY = process.env.ACCULYNX_API_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
const OUT = process.env.OUTPUT_DIR || process.cwd();

const isoDate = (iso) => (iso ? String(iso).slice(0, 10) : null); // "2026-06-30T..." -> "2026-06-30"

async function fail(subject, lines) {
  console.error(`FAIL: ${subject}\n - ${lines.join("\n - ")}`);
  await sendAlert(subject, lines, config.alertRecipients, RESEND_KEY);
  process.exit(1);
}

async function main() {
  if (!API_KEY) await fail("Dashboard refresh failed", ["ACCULYNX_API_KEY is not set"]);

  // 1. Pull all reports.
  let pulled;
  try {
    pulled = await pullAll(config, API_KEY);
  } catch (err) {
    return fail("Dashboard refresh failed — could not pull reports", [err.message]);
  }

  // 2. Parse + collect run dates.
  const rows = {};
  const runDates = {};
  for (const [name, { csv, runDate }] of Object.entries(pulled)) {
    rows[name] = parseCsv(csv);
    runDates[name] = runDate;
  }

  // 3. Run date / quarter / goals.
  // `asOfDate` in config pins the whole view to a specific date's quarter/window — e.g. keep
  // showing last quarter's FINAL numbers until the new quarter's goals are set. Set it to null
  // to auto-roll with the calendar. It still uses the latest reports, so the pinned quarter's
  // numbers stay complete/up-to-date.
  const runYmd = config.asOfDate || isoDate(runDates.sits_tev) || new Date().toISOString().slice(0, 10);
  const qLabel = quarterFor(runYmd).label;
  const goals = goalsAll[qLabel];
  if (!goals) {
    return fail("Dashboard refresh failed — goals not set", [
      `No goals found for "${qLabel}" in goals.json. Add the 7 quarterly targets.`,
    ]);
  }

  // 4. Compute.
  const rr1Data = computeRr1(rows, runYmd, goals, config);
  const rr2Data = computeRr2(rows, runYmd, config);

  // 5. Validate gate.
  const { ok, errors } = validate({ rows, rr1Data, rr2Data, runDates }, config);
  if (!ok) {
    return fail("Dashboard refresh BLOCKED by validation gate", errors);
  }

  // 6. Publish (only on success).
  writeFileSync(join(OUT, "rr1-data.json"), JSON.stringify(rr1Data, null, 2) + "\n");
  writeFileSync(join(OUT, "rr2-data.json"), JSON.stringify(rr2Data, null, 2) + "\n");
  console.log(`OK ${qLabel} @ ${runYmd} — wrote rr1-data.json + rr2-data.json to ${OUT}`);
  console.log(
    `   rr1 sales=$${rr1Data.metrics[0].actual.toLocaleString()} | ` +
      `rr2 team demos=${rr2Data.team.demos} sold=${rr2Data.team.sold}`
  );
}

main().catch((err) => fail("Dashboard refresh crashed", [err.stack || err.message]));
