# dashboard-engine

Auto-updates the Rapid Roofing dashboards (rr1 quarterly thermometer, rr2 sales scoreboard)
from Acculynx — no manual CSV downloads, no retyping.

## How it works
Every ~2 hours a GitHub Action runs `transform/build.mjs`, which:
1. Pulls the 5 scheduled Acculynx CSV reports via the API (`runs/latest → recipients → download fileUrl`).
2. Computes both dashboards' numbers with calibrated formulas (`transform/lib/compute.mjs`).
3. Runs a **validation gate** — if any report is missing/short/stale, it publishes nothing
   (dashboards keep the last good numbers) and emails an alert.
4. On success, writes `rr1-data.json` / `rr2-data.json` and commits them. GitHub Pages serves them;
   the dashboards `fetch()` them.

**No LLM in the loop** — plain deterministic code, so the numbers can't drift.

## Files
- `transform/build.mjs` — entry point.
- `transform/lib/` — `acculynx.mjs` (pull chain), `csv.mjs` (parser), `compute.mjs` (formulas),
  `validate.mjs` (gate), `alert.mjs` (Resend email).
- `transform/config.json` — report IDs, rep roster, setter names, rr1 metric metadata. Rarely changes.
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

## Run locally
```bash
node transform/test-local.mjs /path/to/csv-folder 2026-06-30   # offline, from CSV files
ACCULYNX_API_KEY=… RESEND_API_KEY=… node transform/build.mjs    # live pull + write JSON
```

## Cadence note
The dashboards refresh as often as the Acculynx scheduled reports run. If those run once daily
(~5am), data updates once a day. For intraday freshness, increase the reports' schedule frequency
in Acculynx — the engine automatically picks up whatever the latest run is.

## Alerts: reaching all recipients
`alert.mjs` sends from `onboarding@resend.dev`, which (on a free Resend account) only delivers to the
account owner. To also email joseph@rapidrestore.com, verify a sending domain in Resend and change the
`from:` address in `transform/lib/alert.mjs`.

## Rollback
Each refresh is one commit. To revert, `git revert` the latest data commit — the dashboards' inline
fallback also covers any gap.
