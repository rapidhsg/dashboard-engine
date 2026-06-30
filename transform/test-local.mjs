// Local test: compute rr1/rr2 from CSVs in a folder (no API, no writes).
// Usage: node transform/test-local.mjs <csvDir> <runYmd>
//   e.g. node transform/test-local.mjs /tmp/rr_today 2026-06-30
// CSV files expected: completed_jobs.csv, sales_revenue.csv,
//   revenue_in_progress.csv, leads_by_source.csv, sits_tev.csv

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCsv } from "./lib/csv.mjs";
import { computeRr1, computeRr2, quarterFor } from "./lib/compute.mjs";
import { validate } from "./lib/validate.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(here, "config.json"), "utf8"));
const goalsAll = JSON.parse(readFileSync(join(here, "goals.json"), "utf8"));

const dir = process.argv[2] || "/tmp/rr_today";
const runYmd = process.argv[3] || new Date().toISOString().slice(0, 10);

const NAMES = ["completed_jobs", "sales_revenue", "revenue_in_progress", "leads_by_source", "sits_tev"];
const rows = {};
for (const n of NAMES) rows[n] = parseCsv(readFileSync(join(dir, `${n}.csv`), "utf8"));

const qLabel = quarterFor(runYmd).label;
const goals = goalsAll[qLabel] || goalsAll["Q2 2026"];
const rr1 = computeRr1(rows, runYmd, goals, config);
const rr2 = computeRr2(rows, runYmd, config);

console.log(`\n=== ${qLabel} @ ${runYmd}  (CSVs: ${dir}) ===`);
console.log("\nrr1 — quarterly");
for (const m of rr1.metrics) {
  const v = m.type === "currency" ? "$" + m.actual.toLocaleString() : m.actual.toLocaleString();
  console.log(`  ${m.label.padEnd(24)} ${v.padStart(14)}   goal ${m.goal.toLocaleString()}`);
}
console.log("\nrr2 — scoreboard (rolling-90)");
console.log("  " + "REP".padEnd(20) + "rev/sit".padStart(9) + "demos".padStart(7) + "sold".padStart(6) + "sold$".padStart(12) + "close".padStart(8));
for (const r of [...rr2.reps].sort((a, b) => b.revPerSit - a.revPerSit)) {
  console.log("  " + r.name.padEnd(20) + ("$" + r.revPerSit.toLocaleString()).padStart(9) + String(r.demos).padStart(7) + String(r.sold).padStart(6) + ("$" + r.soldDollars.toLocaleString()).padStart(12) + (r.closeRate + "%").padStart(8));
}
const t = rr2.team;
console.log("  " + "TEAM".padEnd(20) + ("$" + t.revPerSit.toLocaleString()).padStart(9) + String(t.demos).padStart(7) + String(t.sold).padStart(6) + ("$" + t.soldDollars.toLocaleString()).padStart(12) + (t.closeRate + "%").padStart(8));
console.log("\n  setters:");
for (const s of rr2.setters) console.log(`    ${s.name.padEnd(8)} $${s.soldDollars.toLocaleString()}   ${s.apptsSet} appts   ${s.sold} sold   ${s.conversion}%`);

const { ok, errors } = validate({ rows, rr1Data: rr1, rr2Data: rr2, runDates: null }, config);
console.log(`\nvalidation: ${ok ? "PASS" : "FAIL -> " + errors.join("; ")}\n`);
