"""Builds rr1-data.json and rr2-data.json from the ONE shared source: rr-metrics.

Data  = rapidhsg/rr-metrics-data, branch "data" (AccuLynx scheduled sends, refreshed every 15 min).
Rules = rapidhsg/rr-metrics-data, branch "main" (rules/rr_metrics.py + settings.json, locked by Joe).

This file never defines a metric. Every count and dollar comes from rr_metrics.masks(), so the
dashboards always match the rr-metrics skill, the Ninety scorecard and the sales board.
The only things kept here are display settings (config.json) and the quarterly goals (goals.json).

Env: RRM_RULES (folder with rr_metrics.py), RRM_DATA (folder with job_export_raw_latest.csv etc.),
     OUTPUT_DIR (default cwd), RESEND_API_KEY (failure alerts).
On any failure nothing is written (the boards keep the last good numbers) and an alert is emailed.
"""
import json
import os
import sys
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

HERE = Path(__file__).parent
CONFIG = json.loads((HERE / "config.json").read_text())
GOALS = json.loads((HERE / "goals.json").read_text())
RULES = Path(os.environ.get("RRM_RULES", "rrm/rules"))
DATA = Path(os.environ.get("RRM_DATA", "rrd/data"))
OUT = Path(os.environ.get("OUTPUT_DIR", "."))
ET = ZoneInfo("America/New_York")


def alert(subject, lines):
    print(f"FAIL: {subject}\n - " + "\n - ".join(lines), file=sys.stderr)
    key = os.environ.get("RESEND_API_KEY")
    if not key:
        return
    html = f"<h2>{subject}</h2><ul>" + "".join(f"<li>{l}</li>" for l in lines) + \
           "</ul><p style='color:#888'>The dashboards are still showing the last good numbers.</p>"
    body = json.dumps({"from": "Rapid Roofing Dashboards <alerts@updates.mycoresystem.com>",
                       "to": CONFIG["alertRecipients"], "subject": subject, "html": html}).encode()
    req = urllib.request.Request("https://api.resend.com/emails", data=body, method="POST",
                                 headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=20)
    except Exception as e:  # alert failure must never hide the real failure
        print(f"[alert] send failed: {e}", file=sys.stderr)


def fail(subject, lines):
    alert(subject, lines)
    sys.exit(1)


def quarter_for(d):
    q = (d.month - 1) // 3 + 1
    start = d.replace(month=(q - 1) * 3 + 1, day=1)
    end = (start.replace(month=start.month + 2, day=28) + timedelta(days=4))
    end = end - timedelta(days=end.day)
    return {"label": f"Q{q} {d.year}", "startDate": start.isoformat(), "endDate": end.isoformat()}


def main():
    sys.path.insert(0, str(RULES))
    try:
        import rr_metrics as rr
    except Exception as e:
        fail("Dashboard refresh failed: could not load the rr-metrics rules", [repr(e)])

    # 1. Load the shared data and check it is fresh and complete.
    try:
        status = json.loads((DATA / "status.json").read_text())
        run_iso = status["job_export_raw"]["runDate"]
        df = rr.load(str(DATA / "job_export_raw_latest.csv"))
    except Exception as e:
        fail("Dashboard refresh failed: could not read the rr-metrics data", [repr(e)])

    errors = []
    run_dt = datetime.fromisoformat(run_iso[:19]).replace(tzinfo=ZoneInfo("UTC")).astimezone(ET)
    if datetime.now(ET) - run_dt > timedelta(days=2):
        errors.append(f"job export is stale (last AccuLynx run {run_iso})")
    if len(df) < 1000:
        errors.append(f"job export has only {len(df)} rows")
    need = ["Initial Appointment Date", "Primary Estimate Total", "Approved Milestone Date", "Completed Milestone Date",
            "Lead Milestone Date", "Prospect Milestone Date", "Contract Amount", "Primary Salesperson", "Appointment Set By"]
    errors += [f'job export is missing column "{c}"' for c in need if c not in df.columns]
    if errors:
        fail("Dashboard refresh BLOCKED by validation gate", errors)

    run_day = run_dt.date()
    if CONFIG.get("asOfDate"):
        run_day = datetime.fromisoformat(CONFIG["asOfDate"]).date()
    run_ymd = run_day.isoformat()
    q = quarter_for(run_day)
    goals = GOALS.get(q["label"])
    if not goals:
        fail("Dashboard refresh failed: goals not set", [f'No goals for "{q["label"]}" in transform/goals.json.'])

    # 2. RR1: quarter to date, every number straight from the locked rules.
    m = rr.metrics(df, q["startDate"], run_ymd)
    rip, _ = rr.revenue_in_progress(str(DATA / "Revenue_In_Progress_latest.csv"), q["startDate"], q["endDate"])
    actuals = {"sales": m["sales"], "in_progress": rip, "revenue": m["revenue"], "upsells": m["upgrades"],
               "leads": m["leads"], "sits": m["sits"], "jobs": m["jobs_installed"]}
    fresh = {"acculynxRun": run_iso, "scheduleET": CONFIG.get("acculynxScheduleET", []),
             "lagMinutes": CONFIG.get("refreshLagMinutes", 20), "builtAt": datetime.now(ZoneInfo("UTC")).isoformat()}
    rr1 = {"quarter": {**q, "refreshDate": run_ymd}, "freshness": fresh,
           "metrics": [{**x, "actual": round(actuals[x["key"]]), "goal": goals[x["key"]]} for x in CONFIG["rr1Metrics"]]}

    # 3. RR2: rolling window, certified close rate rules, current sales team from settings.json.
    lo, hi = rr.rolling(run_ymd, CONFIG["rollingWindowDays"])
    mk = rr.masks(df, lo, hi)
    ca = df["Contract Amount"].fillna(0)
    display = {r["fullName"]: r for r in CONFIG.get("repDisplay", [])}
    reps = []
    order = [r["fullName"] for r in CONFIG.get("repDisplay", [])]
    for name in sorted(rr.SALES_TEAM, key=lambda n: order.index(n) if n in order else len(order)):
        me = df["Primary Salesperson"] == name
        sits = int((mk["close_sits_team"] & me).sum())
        sold_mask = mk["close_sold_team"] & me
        sold, dollars = int(sold_mask.sum()), round(ca[sold_mask].sum())
        d = display.get(name, {})
        reps.append({"name": name, "short": d.get("short", name.upper()), "role": d.get("role", "OUTSIDE SALES"),
                     "demos": sits, "sold": sold, "soldDollars": dollars,
                     "closeRate": round(100 * sold / sits, 1) if sits else 0,
                     "revPerSit": round(dollars / sits) if sits else 0})
    t_sits = sum(r["demos"] for r in reps)
    t_sold = sum(r["sold"] for r in reps)
    t_dol = sum(r["soldDollars"] for r in reps)
    team = {"demos": t_sits, "sold": t_sold, "soldDollars": t_dol,
            "closeRate": round(100 * t_sold / t_sits, 1) if t_sits else 0,
            "revPerSit": round(t_dol / t_sits) if t_sits else 0}

    # Setters: appointments booked in the window (locked Appointments rule), credited to "Appointment Set By".
    skip = {s.lower() for s in CONFIG.get("setterExclude", [])}
    appts = df[mk["appointments"]].copy()
    appts["_by"] = appts["Appointment Set By"].fillna("").astype(str).str.strip()
    setters = []
    for name, g in appts.groupby("_by"):
        if not name or name.lower() in skip:
            continue
        won = g["Approved Milestone Date"].notna() & g["Current Milestone"].isin(rr.MS["sales_count_if_currently"])
        setters.append({"name": name.upper(), "role": "APPT SETTER", "apptsSet": len(g), "sold": int(won.sum()),
                        "soldDollars": round(g.loc[won, "Contract Amount"].fillna(0).sum()),
                        "conversion": round(100 * won.sum() / len(g), 1) if len(g) else 0})
    setters.sort(key=lambda s: -s["soldDollars"])

    rr2 = {"quarter": {**q, "refreshDate": run_ymd}, "freshness": fresh, "goals": CONFIG.get("rr2Goals"),
           "openSeats": max(0, CONFIG.get("rr2TargetSlots", 0) - len(reps)),
           "team": team, "reps": reps, "setters": setters,
           "source": {"data": "rapidhsg/rr-metrics-data@data", "rules": "rapidhsg/rr-metrics-data@main", "acculynxRun": run_iso}}

    # 4. Final sanity gate, then publish.
    bad = [f'rr1 "{x["key"]}" goal missing' for x in rr1["metrics"] if not goals.get(x["key"])]
    if t_sits <= 0:
        bad.append("rr2 team sits is 0")
    if bad:
        fail("Dashboard refresh BLOCKED by validation gate", bad)
    (OUT / "rr1-data.json").write_text(json.dumps(rr1, indent=2) + "\n")
    (OUT / "rr2-data.json").write_text(json.dumps(rr2, indent=2) + "\n")
    print(f"OK {q['label']} @ {run_ymd} (AccuLynx run {run_iso}): " + ", ".join(f"{k}={v}" for k, v in actuals.items()))


if __name__ == "__main__":
    main()
