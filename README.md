# Dashboard-engine

Builds the data for the Rapid Roofing dashboards (rr1 quarterly thermometer, rr2 sales scoreboard).

## One source of truth
This repo does **not** call AccuLynx and does **not** define any metric. Every 15 minutes a GitHub Action
runs `transform/build.py`, which reads:
- **Data:** `rapidhsg/rr-metrics-data`, branch `data` (the AccuLynx scheduled sends, refreshed every 15 min)
- **Rules:** `rapidhsg/rr-metrics-data`, branch `main` (`rules/rr_metrics.py` + `settings.json`, locked)

So the dashboards always show the same numbers as the rr-metrics skill, the Ninety scorecard and the sales board.
To change how a metric is counted, or who is on the sales team, change it in rr-metrics. Never here.

What stays in this repo:
- `transform/goals.json`: the quarterly goals (update each quarter)
- `transform/config.json`: display settings only (labels, rep display names, setter exclusions, rr2 thresholds)

If the data is stale, missing, or fails a check, nothing is published (the boards keep the last good numbers)
and an alert is emailed.

---
_Previous engine (own AccuLynx pulls and its own rules) was retired on 2026-10-13; see git history._

