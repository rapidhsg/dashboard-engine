# Dashboard `fetch()` change (rr1-index.html & rr2-index.html)

> **No file renaming.** In the live repos the dashboards are each named **`index.html`**
> (that's why they serve at `rapidhsg.github.io/rr1/` and `/rr2/`). The `rr1-index.html` /
> `rr2-index.html` names are only our local workspace copies. Apply the two edits below to the
> existing `index.html` in each repo — nothing gets renamed, no new files, no URL changes.

Two tiny edits per file. **No markup/CSS/layout changes — the UI stays pixel-identical.**
The inline `DATA` block is kept as a hard-coded **fallback** so the screen is never blank
and never breaks if the engine is briefly unreachable. Both dashboards and the engine are
on `rapidhsg.github.io`, so this is **same-origin** (no CORS).

---

## rr1-index.html

**Edit 1 — line 506:** change `const` to `let` (keep the whole inline object as-is, it becomes the fallback):

```js
let DATA = {        // was: const DATA = {
    quarter: { ... },
    metrics: [ ... ],
};
```

**Edit 2 — line 926:** replace the single `render();` call with:

```js
render(); // render fallback immediately so the TV is never blank
// the "?t=" cache-buster changes each minute so GitHub Pages' CDN can't serve a stale copy
fetch("https://rapidhsg.github.io/dashboard-engine/rr1-data.json?t=" + Math.floor(Date.now() / 60000), { cache: "no-store" })
    .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then(function (d) { DATA = d; render(); })
    .catch(function (e) { console.warn("dashboard-engine unreachable, using fallback:", e); });
```

---

## rr2-index.html

**Edit 1 — line 1089:** `const DATA = {` → `let DATA = {`

**Edit 2 — line 1414:** replace `render();` with the same block but pointing at **rr2**:

```js
render();
fetch("https://rapidhsg.github.io/dashboard-engine/rr2-data.json?t=" + Math.floor(Date.now() / 60000), { cache: "no-store" })
    .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then(function (d) { DATA = d; render(); })
    .catch(function (e) { console.warn("dashboard-engine unreachable, using fallback:", e); });
```

---

### Behaviour
- Page loads → renders the inline fallback instantly (no blank/flash).
- ~50 ms later the live JSON arrives → `DATA` swapped, `render()` re-runs → latest numbers.
- Engine down / JSON missing → fallback stays on screen, a console warning, nothing breaks.
- The existing `<meta http-equiv="refresh" content="300">` reloads every 5 min, so the TV
  always re-pulls the freshest committed JSON.
