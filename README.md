# Cadbury Stock Ledger

A warehouse stock-ledger web app for Cadbury distribution. In-line grid entry (Case · Box · Pcs) for daily **Stock In, Stock Out, Wholesale, Retail Extra, Edit/Cancel**, tracked **per warehouse**, with automatic opening→closing carry-forward and exact whole-piece math. Ships pre-loaded with the full product master (MRP + pack ratios).

## Tech
- React 18 + Vite
- Data stored in the browser via `localStorage` (persists per browser/device)

## Run locally
```bash
npm install
npm run dev
```
Open the URL Vite prints (usually http://localhost:5173).

Build a production bundle:
```bash
npm run build      # outputs to dist/
npm run preview    # serve the built bundle locally
```

## Put it on GitHub
```bash
git init
git add .
git commit -m "Cadbury stock ledger"
git branch -M main
git remote add origin https://github.com/<your-username>/cadbury-stock-ledger.git
git push -u origin main
```

## Deploy to Vercel
1. Go to https://vercel.com and sign in with GitHub.
2. **Add New… → Project**, then import the `cadbury-stock-ledger` repo.
3. Vercel auto-detects Vite. Leave defaults:
   - **Framework Preset:** Vite
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
4. Click **Deploy**. You get a live URL in ~1 minute.

(Or from the CLI: `npm i -g vercel` then run `vercel` inside the folder.)

## Important note on data
Stock is saved in the **browser's localStorage**, so:
- It persists on the same browser/device across reloads and sessions.
- It does **not** sync between different people or devices — each browser has its own copy.

If you need one shared, live stock figure across multiple users/devices, the next step is a hosted database (e.g. Supabase, Firebase, or a small API + Postgres). The app is structured so the four storage helpers (`sGet`, `sSet`, and the key builders) are the only place to swap for a backend.

## Editing the product list
Products are seeded from `SEED` at the top of `src/App.jsx`. On first load they're copied into `localStorage` under `cad:products`. To reset to the seed after editing the array, clear that key in the browser console:
```js
localStorage.removeItem('cad:products')
```
Some products in the source sheet had duplicate/blank codes; those were auto-suffixed (`-2`, `-3`) to keep each row distinct — review and rename as needed.
