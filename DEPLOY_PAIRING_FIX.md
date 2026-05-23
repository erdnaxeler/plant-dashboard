# Deploy pairing fix (fixes HTTP 500 on `pair`)

**Cause:** Live Railway is still running old code. Pairing crashes when your 6-digit code is valid because of a timezone bug. The fix is committed locally on branch `railway-plant` but was never pushed to GitHub.

**After deploy works, verify:** open https://plant-dashboard-production.up.railway.app/api/build  
You must see: `{"build":"2026-05-23-pairing-fix-v2"}`

---

## Option A — Push from Cursor (fastest if GitHub is connected)

1. Bottom-left branch name → must be **`railway-plant`**
2. **Source Control** (branch icon) → **Push** (or Sync)
3. Wait 2–3 min for Railway to deploy
4. Open `/api/build` URL above to confirm

---

## Option B — Edit on GitHub in the browser (no terminal)

1. Open: https://github.com/erdnaxeler/plant-dashboard/tree/railway-plant  
2. If branch `railway-plant` does not exist, create it from your machine first (Option A).

3. Open `app.py` → pencil **Edit**

4. Find `def _parse_timestamp` and add **right after** the `_parse_timestamp` function (before `_require_device_auth`):

```python
def _as_utc(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)
```

5. Replace the entire `def device_pair():` function with the version from your local `app.py` (lines with `try:` / `_as_utc` / `except Exception`).

6. Add before `# ---------------- ROUTES ----------------` or after `/health`:

```python
@app.route("/api/build")
def api_build():
    return jsonify({"build": "2026-05-23-pairing-fix-v2"})
```

7. **Commit** → Railway redeploys automatically if the service tracks this repo/branch.

---

## Option C — Railway dashboard

1. railway.app → your service → **Settings** → confirm **Branch** = `railway-plant` (not `main`)
2. **Deployments** → **Redeploy** only helps after GitHub has the fix (Option A or B)

---

## Then pair again

1. Dashboard → **Generate pairing code** (new code)
2. ESP: `pair 123456` or captive portal
3. Expect: `PAIR POST 200` with `"ok":true`
