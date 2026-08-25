# פרטי פריסה — לא סודות, רק מזהים

## Apps Script

- **Script editor:** https://script.google.com/d/1I2qA-EALLN1hxnyrQ6V0TUCk1zrORUiYP9PX3iWbcnKiaN3EE7VenFOk/edit
- **Deployment ID:** `AKfycbzKcgl3JAok2mO5ai5LK2dSkNs4CURTW4eqXUb8ztooJKVk_hTTRxUeEe4l3B2FkVAM7Q`
- **exec URL:** `https://script.google.com/macros/s/AKfycbzKcgl3JAok2mO5ai5LK2dSkNs4CURTW4eqXUb8ztooJKVk_hTTRxUeEe4l3B2FkVAM7Q/exec`
- כבול לגיליון: `19LCKmYIPU-QqUNPgAi_Vons3UK15tRst3slwj4S9oJI`

## עדכון קוד השרת

```bash
nvm use && npm run gas:push
cd apps-script && npx clasp update-deployment AKfycbzKcgl3JAok2mO5ai5LK2dSkNs4CURTW4eqXUb8ztooJKVk_hTTRxUeEe4l3B2FkVAM7Q
```

> `update-deployment` ולא `create-deployment` — deployment חדש מקבל URL חדש
> ומשתנה הסביבה `GAS_URL` ב-Vercel מת באותו רגע.

## סודות

- `SHARED_SECRET` — ב-Script Properties של הפרויקט (Project Settings → Script Properties), לא בקוד ולא כאן.
- אותו ערך יושב ב-Vercel כ-`GAS_SECRET`.
