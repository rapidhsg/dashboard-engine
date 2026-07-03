# Dashboard-engine

Auto-updates the Rapid Roofing dashboards (rr1 quarterly thermometer, rr2 sales scoreboard)
from Acculynx — no manual CSV downloads, no retyping.

## How it works
Every ~2 hours a GitHub Action runs `transform/build.mjs`, which:
1. Pulls the **freshest copy of each report** via the API — across the *bundled* schedules (each delivers all 5 reports) and the individual single-report schedules as a fallback (`runs/latest → recipients → download fileUrl`).
2. Computes both dashboards' numbers with calibrated formulas (`transform/lib/compute.mjs`).
3. Runs a **validation gate** — if any report is missing/short/stale, it publishes nothing
   (dashboards keep the last good numbers) and emails an alert.
4. On success, writes `rr1-data.json` / `rr2-data.json` and commits them. GitHub Pages serves them;
   the dashboards `fetch()` them.

**No LLM in the loop** — plain deterministic code, so the numbers can't drift.

## How it gets the data, and how often

It uses Acculynx's official **API**. The same scheduled reports that get emailed are also available
through the API, so the engine downloads the **exact CSV** — byte-for-byte identical to the email copy.
Access is via a secure Acculynx API key (`ACCULYNX_API_KEY`, stored encrypted in GitHub Actions secrets
— never in code). Per report it's three calls: **get latest run → get the file link → download the file**
(`runs/latest → recipients → fileUrl`).

**It always uses the freshest copy of each report.** The engine checks every schedule in
`config.json` — the **bundled** schedules (each one delivers all 5 reports) *and* the individual
single-report schedules — and for each report picks the file from the **most recent run**. Files are
matched to reports by filename prefix (`completed_jobs`, `sales_revenue`, …). If a bundled schedule
hasn't fired yet, it silently falls back to the individual reports, so the board never goes dark.

**Frequency — two layers:**
- The engine runs **every ~2 hours** (GitHub Actions cron + on-demand "Run workflow").
- Data is only as fresh as Acculynx *generates* the reports. The bundled schedules run **intraday
  (e.g. 12pm + 4pm)** on top of the **5am** individual reports — so numbers refresh a few times a day,
  and the engine auto-picks whichever ran most recently. Add more scheduled times in Acculynx (drop
  the new schedule id into `config.bundledScheduleIds`) for even fresher data.
- The TVs **auto-reload every 5 minutes**, so they always show the latest published numbers.

## Metric definitions (the rule set)

Exact definition of every number, straight from the source reports.

### rr1 — Quarterly Thermometer (quarter-to-date, e.g. Apr 1 → today)
| Metric | Source report | Definition |
|---|---|---|
| Sales $$$ Contracted | Sales Revenue | Σ Contract Amount where **Approved Date** is in the quarter and Work Type ∈ {New, Repair, Upsell/Change Order} (excludes Insurance, Inspection, Service) |
| Revenue In Progress | Revenue In Progress | Σ Job Value of all jobs currently in production |
| Revenue Installed | Completed Jobs | Σ Contract Amount where **Completed Milestone Date** is in the quarter |
| Upsells $ | Completed Jobs | Σ Contract Amount where **Completed Milestone Date** is in the quarter and Work Type = Upsell / Change Order (installed basis — matches the CEO's "Upgrades") |
| Leads | Leads by Source | Count where **Lead Milestone Date** is in the quarter |
| Sits | Sits & Tev | Count where **Initial Appointment Date** is in the quarter |
| Total Jobs Installed | Completed Jobs | Count completed in quarter, **excluding** Upsell / Change Order (not separate installs) |

### rr2 — Scoreboard (rolling 90 days through today), per **Primary Salesperson**
| Metric | Source | Definition |
|---|---|---|
| Demos | Sits & Tev | Count of appointments with Initial Appt Date in last 90 days **where Primary Estimate Amount > 0** (actually sat & quoted — filters out no-shows) |
| Sold | Sales Revenue | Count of jobs **Approved** in last 90 days |
| Sold $ | Sales Revenue | Σ Contract Amount of those |
| Close Rate | — | Sold ÷ Demos |
| Rev/Sit | — | Sold $ ÷ Demos |
| Team | — | Totals across all reps |

**Setters** (grouped by **Appointment Set By** — e.g. Kelly, Joshua, Janet):
- **Appts Set** = appointments they set in the last 90 days
- **Sold** = how many reached Approved or beyond
- **$ Generated** = Σ Job Value of those sold
- **Conversion** = Sold ÷ Appts Set

**Goals** (the targets on rr1) are the only manually-set numbers — entered once per quarter in
`goals.json`; the quarter dates roll automatically.

## Files
- `transform/build.mjs` — entry point.
- `transform/lib/` — `acculynx.mjs` (pull chain), `csv.mjs` (parser), `compute.mjs` (formulas),
  `validate.mjs` (gate), `alert.mjs` (Resend email).
- `transform/config.json` — schedule IDs (`bundledScheduleIds` = all-5 bundled schedules + individual `reports` fallbacks), rep roster, setter names, rr1 metric metadata, and `asOfDate` (see "Hold a quarter"). Rarely changes.
- `transform/goals.json` — **the 7 quarterly goal numbers** (the only thing edited each quarter).
- `transform/test-local.mjs` — run the formulas against a folder of CSVs (no API).
- `rr1-data.json` / `rr2-data.json` — generated outputs (served by Pages).
- `.github/workflows/refresh.yml` — the scheduler (here as `.github-workflows-refresh.yml` in the scaffold).

## Secrets (repo → Settings → Secrets and variables → Actions)
- `ACCULYNX_API_KEY` — Acculynx API key.
- `RESEND_API_KEY` — for failure-alert emails (to joseph@ + segun@).

## Updating quarterly goals (the only recurring task — ~4×/year)
Edit `transform/goals.json`: add/adjust the block for the quarter, e.g. `"Q3 2026": { ... 7 numbers ... }`.
Quarter **dates roll automatically** from the calendar — you only set the 7 targets.
(`in_progress` = the weekly install target = Revenue Installed goal ÷ 13 weeks.)

## Hold a quarter (`asOfDate`)
At a quarter changeover the new quarter starts near-zero, which can look empty before its goals are set.
Set `config.json` `"asOfDate": "YYYY-MM-DD"` to **pin** the dashboards to that date's quarter/window
(it still pulls the latest reports, so the pinned quarter stays complete). Set it back to `null` to
**auto-roll** with the calendar. (Used to keep Q2-final on screen until the Q3 goals were entered.)

## Run locally
```bash
node transform/test-local.mjs /path/to/csv-folder 2026-06-30   # offline, from CSV files
ACCULYNX_API_KEY=… RESEND_API_KEY=… node transform/build.mjs    # live pull + write JSON
```

