import React, { useState, useEffect, useMemo, useCallback, useDeferredValue, useRef } from "react";
import { supabase, kvGetMany, kvSet, kvSetBg, kvGetLike, kvGetRange, kvUpsertMany, kvDeleteMany, onStorageError } from "./storage";
import * as XLSX from "xlsx";


const WAREHOUSES_DEFAULT = ["Main Warehouse"];

// movement columns the client uses
const MOVES = [
  { key: "in",     label: "Stock In",     sign: +1, color: "#1b7f4d" },
  { key: "out",    label: "Stock Out",    sign: -1, color: "#b3261e" },
  { key: "whole",  label: "Wholesale",    sign: -1, color: "#8a5a00" },
  { key: "retail", label: "Retail Extra", sign: -1, color: "#6b3fa0" },
  { key: "edit",   label: "Edit/Cancel",  sign: +1, color: "#0a6e7a" },
];

// ---------- helpers ----------
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fmtDate = (s) => {
  const [y, m, dd] = s.split("-");
  const mo = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][parseInt(m,10)-1];
  return `${dd}-${mo}-${y}`;
};
// pure calendar arithmetic — no timezone conversions (the old version shifted
// through UTC, which skipped/repeated days for anyone east of Greenwich)
const addDays = (s, n) => {
  const [y, m, dd] = s.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, dd + n));
  return d.toISOString().slice(0, 10);
};
const inr = (n) => "₹" + Math.round(n).toLocaleString("en-IN");

// total pieces from case/box/pcs using product pack ratios
const toPcs = (c, b, p, pcsCase, pcsOuter) =>
  (c || 0) * pcsCase + (b || 0) * pcsOuter + (p || 0);
// pcs back into case / box / pcs for display
const fromPcs = (total, pcsCase, pcsOuter) => {
  let t = total, neg = t < 0;
  t = Math.abs(t);
  const c = pcsCase > 0 ? Math.floor(t / pcsCase) : 0;
  t -= c * pcsCase;
  const b = pcsOuter > 0 ? Math.floor(t / pcsOuter) : 0;
  t -= b * pcsOuter;
  const p = t;
  const s = neg ? -1 : 1;
  return { c: c * s, b: b * s, p: p * s };
};

// --- per-unit Case·Box·Pcs model (stock kept literally as entered, never re-bundled) ---
const ZERO = { c: 0, b: 0, p: 0 };
// normalize any stored opening value (legacy number, or {c,b,p}) to a raw {c,b,p}
const asCBP = (v, pr) => {
  if (v == null) return { ...ZERO };
  if (typeof v === "number") return fromPcs(v, pr.pcsCase, pr.pcsOuter);
  return { c: v.c || 0, b: v.b || 0, p: v.p || 0 };
};
const cbpPcs = (cbp, pr) => toPcs(cbp.c, cbp.b, cbp.p, pr.pcsCase, pr.pcsOuter);
// opening ± each day's movements, component by component (no carrying between units)
const computeClosing = (openCBP, mv) => {
  let c = openCBP.c || 0, b = openCBP.b || 0, p = openCBP.p || 0;
  if (mv) MOVES.forEach((m) => {
    const cell = mv[m.key];
    if (cell) { c += m.sign * (cell.c || 0); b += m.sign * (cell.b || 0); p += m.sign * (cell.p || 0); }
  });
  return { c, b, p };
};
// minimum borrow: if pcs run short, break just enough boxes into pcs; if boxes then
// run short, break just enough cases into boxes. Never compresses positives upward,
// and never changes the total piece count.
const borrow = (cbp, pr) => {
  let c = cbp.c || 0, b = cbp.b || 0, p = cbp.p || 0;
  const po = pr && pr.pcsOuter > 0 ? pr.pcsOuter : 0;
  const bpc = po > 0 && pr.pcsCase > 0 ? Math.round(pr.pcsCase / po) : 0;
  if (p < 0 && po > 0) { const k = Math.ceil(-p / po); p += k * po; b -= k; }
  if (b < 0 && bpc > 0) { const k = Math.ceil(-b / bpc); b += k * bpc; c -= k; }
  return { c, b, p };
};

// storage keys
const prodKey = (wh) => `cad:products:${wh}`;             // product master — separate per warehouse
const K_WAREHOUSES = "cad:warehouses";
const K_CONFIG = "cad:config";
const K_USERS = "cad:users";   // email -> { role: "admin"|"user", warehouses: [names] }

// pricing defaults (editable in the Configuration tab)
const CONFIG_DEFAULT = { ourMargin: 5.31, perSku: {} }; // ourMargin in %, fixed across SKUs
const SKU_DEFAULTS = { margin: 1.12, gst: 5, ws: 15 };  // retailer margin divisor, GST %, wholesale % off MRP

// per-SKU pricing: retail rate, RD (our cost incl GST), cost ex-GST, wholesale rate,
// and per-piece profit (ex-GST) on retail and wholesale sales
const skuPricing = (mrp, cfg, ourMargin) => {
  const m = cfg.margin || SKU_DEFAULTS.margin;
  const g = (cfg.gst ?? SKU_DEFAULTS.gst) / 100;
  const retail = mrp / m;
  const rd = retail / (1 + ourMargin / 100);
  const cost = rd / (1 + g);
  const ws = mrp * (1 - (cfg.ws ?? SKU_DEFAULTS.ws) / 100);
  const retailNet = retail / (1 + g);        // retail sale value per pc, ex-GST
  const wsNet = ws / (1 + g);                // wholesale sale value per pc, ex-GST
  const profitR = retailNet - cost;          // retail sale profit per pc, ex-GST
  const profitW = wsNet - cost;              // wholesale sale profit per pc, ex-GST
  return { retail, rd, cost, ws, retailNet, wsNet, profitR, profitW };
};
const mvKey = (wh, date) => `cad:mv:${wh}:${date}`;       // movements for a warehouse-day
const openKey = (wh, date) => `cad:open:${wh}:${date}`;   // opening snapshot (carry)
const countKey = (wh, date) => `cad:count:${wh}:${date}`; // physical stock-take counts
const remarkKey = (wh, date) => `cad:remark:${wh}:${date}`; // stock-take remarks (code -> text)
const lockKey = (wh, date) => `cad:lock:${wh}:${date}`;   // day locked after Save Day

// storage lives in Supabase (src/storage.js) — shared across all devices/users.

// ---------- tiny decimal cell (for config: margins, GST %) ----------
function DecCell({ value, onChange, suffix }) {
  const [v, setV] = useState(value == null ? "" : String(value));
  useEffect(() => { setV(value == null ? "" : String(value)); }, [value]);
  return (
    <span className="dwrap">
      <input
        className="ncell dcell"
        inputMode="decimal"
        value={v}
        onChange={(e) => setV(e.target.value.replace(/[^0-9.]/g, ""))}
        onBlur={() => {
          const n = parseFloat(v);
          if (isNaN(n)) { setV(value == null ? "" : String(value)); return; }
          onChange(n);
        }}
        onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
      />
      {suffix && <span className="dsuf">{suffix}</span>}
    </span>
  );
}

// resolve a warehouse-day's opening: latest uploaded snapshot on/before the day,
// rolled forward through every saved day's movements since (unlimited history,
// fetched with two small ranged queries).
async function resolveOpening(whName, d, prods) {
  // both ranges fetched in parallel — one round trip's latency instead of two
  const [opens, mvAll] = await Promise.all([
    kvGetRange(openKey(whName, "0000-00-00"), openKey(whName, d)),
    kvGetRange(mvKey(whName, "0000-00-00"), mvKey(whName, addDays(d, -1))),
  ]);
  if (!opens.length) return {};
  opens.sort((a, b) => (a.key < b.key ? 1 : -1));   // newest first
  const base = opens[0];
  const baseDate = base.key.slice(-10);
  const byCode = {};
  prods.forEach((p) => (byCode[p.code] = p));
  // start from the snapshot, as raw {c,b,p} (legacy numeric snapshots are converted)
  const open = {};
  Object.entries(base.value || {}).forEach(([code, v]) => {
    const pr = byCode[code];
    open[code] = pr ? asCBP(v, pr) : (typeof v === "number" ? { c: 0, b: 0, p: v } : { c: v.c || 0, b: v.b || 0, p: v.p || 0 });
  });
  if (baseDate === d) return open;
  // roll movements forward, component by component (no re-bundling)
  const mvRows = mvAll.filter((r) => r.key.slice(-10) >= baseDate);
  mvRows.forEach((r) => {
    Object.entries(r.value || {}).forEach(([code, row]) => {
      if (!byCode[code] || !row) return;
      const cur = open[code] || { ...ZERO };
      MOVES.forEach((mm) => {
        const cell = row[mm.key];
        if (cell) { cur.c += mm.sign * (cell.c || 0); cur.b += mm.sign * (cell.b || 0); cur.p += mm.sign * (cell.p || 0); }
      });
      open[code] = cur;
    });
  });
  return open;
}

// ---------- dashboard aggregation ----------
function aggWarehouse(prods, open, mvs, config) {
  let openVal = 0, closeVal = 0, costVal = 0, neg = 0, withStock = 0;
  const mvTot = {}; MOVES.forEach((m) => (mvTot[m.key] = 0));
  const list = [];
  prods.forEach((p) => {
    const oCBP = open[p.code] || { ...ZERO };
    const o = cbpPcs(oCBP, p);
    const mv = mvs[p.code];
    if (mv) MOVES.forEach((m) => {
      const c = mv[m.key];
      if (c) mvTot[m.key] += toPcs(c.c, c.b, c.p, p.pcsCase, p.pcsOuter);
    });
    const cl = cbpPcs(computeClosing(oCBP, mv), p);
    openVal += o * p.mrp; closeVal += cl * p.mrp;
    costVal += cl * skuPricing(p.mrp, config.perSku[p.code] || {}, config.ourMargin).cost;
    if (cl < 0) neg++;
    if (cl > 0) withStock++;
    const out = mv && mv.out ? toPcs(mv.out.c, mv.out.b, mv.out.p, p.pcsCase, p.pcsOuter) : 0;
    list.push({ code: p.code, desc: p.desc, cl, val: cl * p.mrp, out });
  });
  const topOut = list.filter((x) => x.out > 0).sort((a, b) => b.out - a.out).slice(0, 5);
  const topVal = list.filter((x) => x.val > 0).sort((a, b) => b.val - a.val).slice(0, 5);
  return { openVal, closeVal, costVal, mvTot, neg, withStock, total: prods.length, topOut, topVal };
}

// ---------- login screen ----------
function Login() {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
    if (error) setErr(error.message === "Invalid login credentials" ? "Wrong email or password." : error.message);
    setBusy(false);
  };
  return (
    <div className="wrap" style={{ display: "grid", placeItems: "center", minHeight: "100vh" }}>
      <style>{CSS}</style>
      <form className="loginbox" onSubmit={go}>
        <div className="logo" style={{ margin: "0 auto 10px" }} aria-label="Anchor">⚓</div>
        <div className="title" style={{ textAlign: "center", color: "#2a2018" }}>ANCHOR</div>
        <div className="sub" style={{ textAlign: "center", color: "#6b5a45", marginBottom: 4 }}>Stock &amp; Inventory · Kwality Ventures</div>
        <div className="sub" style={{ textAlign: "center", color: "#6b5a45", marginBottom: 18 }}>Sign in to continue</div>
        <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></label>
        <label>Password<input type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        {err && <div className="aperr">{err}</div>}
        <button className="save" type="submit" disabled={busy || !email || !pw} style={{ width: "100%", marginTop: 14, padding: "11px" }}>
          {busy ? "Signing in…" : "Sign In"}
        </button>
        <div className="sub" style={{ textAlign: "center", color: "#9a8a72", marginTop: 14 }}>
          No account? Ask your administrator.
        </div>
        <div className="credit" style={{ marginTop: 16 }}>An app by Jain Ankit and Co, Chartered Accountants</div>
      </form>
    </div>
  );
}

// ---------- text cell (code / name editing) ----------
function TextCell({ value, onCommit, width }) {
  const [v, setV] = useState(value ?? "");
  useEffect(() => { setV(value ?? ""); }, [value]);
  return (
    <input
      className="ncell tcell"
      style={width ? { width } : undefined}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { if (v.trim() !== (value ?? "")) onCommit(v.trim()); }}
      onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
    />
  );
}

// ---------- stock sheet upload (admin) ----------
// Builds this warehouse's product master AND opening stock from one sheet.
// Header row must contain: CODE, PRODUCT/DESCRIPTION, MRP, BOX/CASE, PCS/BOX,
// and opening quantity columns CASE, BOX, PCS (plain names, no "/").
function UploadOpeningPanel({ products, wh, onApply, onClose }) {
  const [asOn, setAsOn] = useState("2026-06-01");
  const [preview, setPreview] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const parseFile = async (file) => {
    setErr(""); setPreview(null);
    try {
      const wb = XLSX.read(await file.arrayBuffer());
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
      const hi = rows.findIndex((r) => r.some((c) => /code/i.test(String(c))));
      if (hi < 0) throw new Error("No header row with a CODE column found.");
      const hdr = rows[hi].map((c) => String(c).toLowerCase().replace(/\s+/g, " ").trim());
      const find = (re) => hdr.findIndex((h) => re.test(h));
      const ci = find(/code/);
      const di = find(/desc|product|name|item/);
      const mi = find(/mrp|price/);
      const bpcI = find(/box(es)? ?\/ ?case|box(es)? per case/);      // ratio: boxes per case
      const ppbI = find(/pcs ?\/ ?box|pcs per box|pieces ?\/ ?box/);  // ratio: pcs per box
      const wsI = hdr.findIndex((h) => /margin/.test(h) && /ws|whole/.test(h));            // wholesale margin %
      const rmI = hdr.findIndex((h) => /margin/.test(h) && !/ws|whole/.test(h));           // retailer margin (divisor)
      // opening quantities: plain CASE / BOX / PCS columns (must not contain "/")
      const plain = (re) => hdr.findIndex((h) => re.test(h) && !h.includes("/"));
      const caseI = plain(/^(opening )?cases?$/);
      const boxI = plain(/^(opening )?box(es)?$/);
      const pcsI = plain(/^(opening )?(pcs|pieces)$/);
      if (caseI < 0 && boxI < 0 && pcsI < 0) throw new Error("No opening CASE / BOX / PCS columns found.");

      const byCode = {};
      products.forEach((p) => (byCode[p.code.toLowerCase()] = p));
      const open = {}, newProducts = [], updates = {}, skipped = [], cfgUpdates = {};
      const seen = new Set();
      for (let i = hi + 1; i < rows.length; i++) {
        const r = rows[i];
        const code = String(r[ci] ?? "").trim();
        if (!code || seen.has(code.toLowerCase())) continue;
        seen.add(code.toLowerCase());
        const num = (idx) => (idx >= 0 ? parseFloat(r[idx]) || 0 : 0);
        const int = (idx) => (idx >= 0 ? parseInt(r[idx], 10) || 0 : 0);
        let p = byCode[code.toLowerCase()];
        if (!p) {
          // create from sheet — needs desc, mrp and pack ratios
          const desc = di >= 0 ? String(r[di]).trim() : "";
          const mrp = num(mi);
          const boxes = int(bpcI), pcsOuter = int(ppbI);
          if (!desc || mrp <= 0 || boxes <= 0 || pcsOuter <= 0) { skipped.push(code); continue; }
          p = { code, desc, mrp, pcsOuter, pcsCase: boxes * pcsOuter, openCase: 0, openBox: 0, openPcs: 0 };
          newProducts.push(p);
        } else {
          // existing product: refresh master fields the sheet provides
          const f = {};
          if (di >= 0 && String(r[di]).trim()) f.desc = String(r[di]).trim();
          if (mi >= 0 && num(mi) > 0) f.mrp = num(mi);
          const boxes = int(bpcI), pcsOuter = int(ppbI);
          if (boxes > 0 && pcsOuter > 0) { f.pcsOuter = pcsOuter; f.pcsCase = boxes * pcsOuter; }
          if (Object.keys(f).length) updates[p.code] = f;
          p = { ...p, ...f };
        }
        open[p.code] = { c: int(caseI), b: int(boxI), p: int(pcsI) };   // raw, exactly as entered
        // per-SKU margins (only stored when the sheet provides a value)
        const cfg = {};
        if (rmI >= 0 && num(rmI) > 0) cfg.margin = num(rmI);
        if (wsI >= 0 && num(wsI) > 0) cfg.ws = num(wsI);
        if (Object.keys(cfg).length) cfgUpdates[p.code] = cfg;
      }
      if (!Object.keys(open).length) throw new Error("No usable rows found.");
      setPreview({ open, newProducts, updates, skipped, cfgUpdates });
    } catch (e) {
      setErr(e.message || String(e));
    }
  };

  const apply = async () => {
    setBusy(true);
    try {
      await onApply(asOn, preview.open, preview.newProducts, preview.updates, preview.cfgUpdates);
      onClose();
    } catch (e) { setErr(e.message || String(e)); }
    setBusy(false);
  };

  return (
    <div className="addpanel">
      <div className="aprow">
        <label>Opening as on<input type="date" value={asOn} onChange={(e) => setAsOn(e.target.value)} style={{ width: 140 }} /></label>
        <label className="wide">Stock sheet (.xlsx / .csv) — CODE, PRODUCT, MRP, BOX/CASE, PCS/BOX, CASE, BOX, PCS (+ optional RETAILER MARGIN, WS MARGIN %)
          <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files[0] && parseFile(e.target.files[0])} />
        </label>
        {preview && <button className="save" onClick={apply} disabled={busy}>{busy ? "Applying…" : `Apply to ${wh}`}</button>}
        <button className="ghost2" onClick={onClose}>Cancel</button>
      </div>
      {preview && (
        <div className="apwarn" style={{ color: "#1b7f4d" }}>
          ✓ {preview.newProducts.length} new products will be created, {Object.keys(preview.updates).length} existing updated,
          opening stock set for {Object.keys(preview.open).length} products in <b>{wh}</b> as on {asOn}.
          {Object.keys(preview.cfgUpdates).length > 0 && <> Margins set for {Object.keys(preview.cfgUpdates).length} products.</>}
          {preview.skipped.length > 0 && (
            <div className="aperr">⚠ {preview.skipped.length} rows skipped (missing product/MRP/Box-Case/Pcs-Box): {preview.skipped.slice(0, 12).join(", ")}{preview.skipped.length > 12 ? "…" : ""}</div>
          )}
        </div>
      )}
      {err && <div className="aperr">{err}</div>}
    </div>
  );
}

// ---------- users panel (admin) ----------
function UsersPanel({ usersMap, saveUsers, warehouses, myEmail }) {
  const [newEmail, setNewEmail] = useState("");
  const emails = Object.keys(usersMap).sort();
  const setUser = (em, patch) => saveUsers({ ...usersMap, [em]: { ...usersMap[em], ...patch } });
  const toggleWh = (em, w) => {
    const cur = usersMap[em].warehouses || [];
    setUser(em, { warehouses: cur.includes(w) ? cur.filter((x) => x !== w) : [...cur, w] });
  };
  const addUser = () => {
    const em = newEmail.trim().toLowerCase();
    if (!em || !em.includes("@")) return;
    if (usersMap[em]) { alert("Already in the list."); return; }
    saveUsers({ ...usersMap, [em]: { role: "user", warehouses: [] } });
    setNewEmail("");
  };
  const removeUser = (em) => {
    if (em === myEmail) return;
    if (!window.confirm(`Remove access for ${em}?`)) return;
    const next = { ...usersMap };
    delete next[em];
    saveUsers(next);
  };
  return (
    <div className="report">
      <div className="hint" style={{ paddingTop: 10 }}>
        Two steps to give someone access: <b>1.</b> create their login in Supabase → Authentication → Users → Add user
        (email + password, auto-confirm on). <b>2.</b> add the same email here and allot warehouses.
        Warehouse users can enter stock, stock-take, see reports, add products, and edit product code/name only.
      </div>
      <div className="addpanel" style={{ margin: "10px 18px" }}>
        <div className="aprow">
          <label className="wide">Add user by email<input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="staff@example.com" /></label>
          <button className="save" onClick={addUser}>Add</button>
        </div>
      </div>
      <div className="gridwrap" style={{ maxHeight: "none" }}>
        <table className="grid">
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Email</th>
              <th>Role</th>
              <th style={{ textAlign: "left" }}>Allotted Warehouses</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {emails.map((em) => {
              const u = usersMap[em];
              const self = em === myEmail;
              return (
                <tr key={em}>
                  <td className="mono" style={{ fontSize: 12 }}>{em}{self && <span className="dim"> (you)</span>}</td>
                  <td className="inp">
                    <select value={u.role} disabled={self} onChange={(e) => setUser(em, { role: e.target.value })}
                      style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid #d2c2a8", background: "#fffdf8" }}>
                      <option value="user">user</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td>
                    {u.role === "admin" ? <span className="dim">all warehouses</span> :
                      warehouses.map((w) => (
                        <label key={w} className="zt" style={{ display: "inline-flex", marginRight: 14 }}>
                          <input type="checkbox" checked={(u.warehouses || []).includes(w)} onChange={() => toggleWh(em, w)} />
                          {w}
                        </label>
                      ))}
                  </td>
                  <td className="inp">
                    {!self && <button className="unct" onClick={() => removeUser(em)}>✕ Remove</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- excel-style header filter ----------
function FilterTh({ label, sub, col, values, selected, openCol, setOpenCol, onApply, thClass }) {
  const [q, setQ] = useState("");
  const open = openCol === col;
  const active = selected != null;
  const shown = values.filter((v) => !q || String(v).toLowerCase().includes(q.toLowerCase()));
  const isChecked = (v) => !selected || selected.includes(String(v));
  const toggle = (v) => {
    const cur = selected ? [...selected] : values.map(String);
    const sv = String(v);
    const next = cur.includes(sv) ? cur.filter((x) => x !== sv) : [...cur, sv];
    onApply(next.length === values.length ? null : next);
  };
  return (
    <th className={(thClass || "num") + (open ? " fopen" : "")}>
      <span className="hfhead">
        {label}{sub && <><br /><span>{sub}</span></>}
        <button className={"hfbtn" + (active ? " on" : "")} title="Filter"
          onClick={(e) => { e.stopPropagation(); setQ(""); setOpenCol(open ? null : col); }}>▼</button>
      </span>
      {open && (
        <div className="hfpop" onClick={(e) => e.stopPropagation()}>
          <input className="hfsearch" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <div className="hfactions">
            <button onClick={() => onApply(null)}>Select all</button>
            <button onClick={() => onApply([])}>Unselect all</button>
          </div>
          <div className="hflist">
            {shown.map((v) => (
              <label key={String(v)} className="hfitem">
                <input type="checkbox" checked={isChecked(v)} onChange={() => toggle(v)} />
                {String(v)}
              </label>
            ))}
            {shown.length === 0 && <div className="hfempty">No values</div>}
          </div>
        </div>
      )}
    </th>
  );
}

// ---------- add product panel ----------
function AddProductPanel({ products, onAdd, onClose }) {
  const [f, setF] = useState({ code: "", desc: "", mrp: "", boxes: "", pcsOuter: "" });
  const [err, setErr] = useState("");
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const codeTrim = f.code.trim();
  const dupCode = codeTrim && products.some((p) => p.code.toLowerCase() === codeTrim.toLowerCase());
  const descTrim = f.desc.trim();
  const dupDesc = descTrim && products.find((p) => p.desc.trim().toLowerCase() === descTrim.toLowerCase() && Number(p.mrp) === parseFloat(f.mrp));
  const boxes = parseInt(f.boxes, 10) || 0;
  const pcsOuter = parseInt(f.pcsOuter, 10) || 0;
  const pcsCase = boxes * pcsOuter; // auto-calculated

  const submit = () => {
    setErr("");
    if (!codeTrim) return setErr("Code is required.");
    if (dupCode) return setErr(`Code "${codeTrim}" already exists — codes must be unique.`);
    if (!descTrim) return setErr("Description is required.");
    const mrp = parseFloat(f.mrp);
    if (!(mrp > 0)) return setErr("MRP must be a number greater than 0.");
    if (boxes <= 0) return setErr("Box/Case must be at least 1.");
    if (pcsOuter <= 0) return setErr("Pcs/Box must be at least 1.");
    if (dupDesc && !window.confirm(`A product with the same description and MRP already exists (code ${dupDesc.code}). Add anyway?`)) return;
    onAdd({ code: codeTrim, desc: descTrim, mrp, pcsOuter, pcsCase, openCase: 0, openBox: 0, openPcs: 0 });
    onClose();
  };

  return (
    <div className="addpanel">
      <div className="aprow">
        <label>Code<input value={f.code} onChange={set("code")} placeholder="e.g. FUSE60" className={dupCode ? "bad" : ""} /></label>
        <label className="wide">Description<input value={f.desc} onChange={set("desc")} placeholder="e.g. CADBURY FUSE 55G RS-60" /></label>
        <label>MRP ₹<input value={f.mrp} onChange={set("mrp")} inputMode="decimal" /></label>
        <label>Box/Case<input value={f.boxes} onChange={set("boxes")} inputMode="numeric" placeholder="10" /></label>
        <label>Pcs/Box<input value={f.pcsOuter} onChange={set("pcsOuter")} inputMode="numeric" placeholder="20" /></label>
        <label>Pcs/Case<span className="apauto">{pcsCase > 0 ? pcsCase : "auto"}</span></label>
        <button className="save" onClick={submit}>Add Product</button>
        <button className="ghost2" onClick={onClose}>Cancel</button>
      </div>
      {dupCode && <div className="aperr">⚠ Code "{codeTrim}" is already taken.</div>}
      {!dupCode && dupDesc && <div className="apwarn">⚠ Same description + MRP exists as code {dupDesc.code} — possible duplicate.</div>}
      {err && <div className="aperr">{err}</div>}
    </div>
  );
}

// ---------- tiny numeric cell ----------
// move focus to the nearest input cell in a direction (spreadsheet-style arrows)
function gridMove(el, dir) {
  const wrap = el.closest(".gridwrap");
  if (!wrap) return false;
  const inputs = [...wrap.querySelectorAll("input.ncell:not([disabled])")];
  const r = el.getBoundingClientRect();
  let best = null, bestScore = Infinity;
  for (const o of inputs) {
    if (o === el) continue;
    const b = o.getBoundingClientRect();
    const dx = b.left - r.left, dy = b.top - r.top;
    let ok = false, score = 0;
    if (dir === "right") { ok = dx > 1 && Math.abs(dy) < r.height; score = dx + Math.abs(dy) * 4; }
    else if (dir === "left") { ok = dx < -1 && Math.abs(dy) < r.height; score = -dx + Math.abs(dy) * 4; }
    else if (dir === "down") { ok = dy > 1 && Math.abs(dx) < r.width; score = dy + Math.abs(dx) * 4; }
    else if (dir === "up") { ok = dy < -1 && Math.abs(dx) < r.width; score = -dy + Math.abs(dx) * 4; }
    if (ok && score < bestScore) { bestScore = score; best = o; }
  }
  if (best) { best.focus(); if (best.select) best.select(); return true; }
  return false;
}

function NumCell({ value, onChange, accent, disabled }) {
  const [v, setV] = useState(value === 0 || value == null ? "" : String(value));
  useEffect(() => { setV(value === 0 || value == null ? "" : String(value)); }, [value]);
  const onKey = (e) => {
    if (e.key === "Enter") { e.target.blur(); return; }
    const el = e.target, atStart = el.selectionStart === 0 && el.selectionEnd === 0;
    const atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length;
    let dir = null;
    if (e.key === "ArrowUp") dir = "up";
    else if (e.key === "ArrowDown") dir = "down";
    else if (e.key === "ArrowLeft" && atStart) dir = "left";
    else if (e.key === "ArrowRight" && atEnd) dir = "right";
    if (dir && gridMove(el, dir)) e.preventDefault();
  };
  return (
    <input
      className="ncell"
      inputMode="numeric"
      value={v}
      disabled={disabled}
      style={accent ? { color: accent } : undefined}
      onChange={(e) => {
        const raw = e.target.value.replace(/[^0-9\-]/g, "");
        setV(raw);
      }}
      onBlur={() => {
        const n = parseInt(v, 10);
        onChange(isNaN(n) ? 0 : n);
      }}
      onKeyDown={onKey}
    />
  );
}

export default function App() {
  const [products, setProducts] = useState(null);
  const [warehouses, setWarehouses] = useState(WAREHOUSES_DEFAULT);
  const [wh, setWh] = useState(WAREHOUSES_DEFAULT[0]);
  const [date, setDate] = useState(todayStr());
  const [moves, setMoves] = useState({});       // code -> {in:{c,b,p}, out:{...}, ...}
  const [opening, setOpening] = useState({});    // code -> {c,b,p} (raw, carried)
  const [query, setQuery] = useState("");
  const [activeMove, setActiveMove] = useState("in");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("dashboard");   // dashboard | entry | stocktake | report | monthly | config | users
  const [showZero, setShowZero] = useState(true);
  const [config, setConfig] = useState(CONFIG_DEFAULT);

  // config is not day-based — persist immediately on every change
  const saveConfig = (next) => { setConfig(next); kvSetBg(K_CONFIG, next); };
  const setSkuCfg = (code, field, val) => {
    const next = { ...config, perSku: { ...config.perSku, [code]: { ...(config.perSku[code] || {}), [field]: val } } };
    saveConfig(next);
  };
  const [showAdd, setShowAdd] = useState(false);
  // config tab: excel-style column filters — col -> array of selected values (null = all)
  const [cfgSel, setCfgSel] = useState({});
  const [cfgOpenF, setCfgOpenF] = useState(null);
  const setColFilter = (col) => (arr) => setCfgSel((prev) => ({ ...prev, [col]: arr }));

  // ---- physical stock take (per warehouse-day, auto-saved) ----
  const [counts, setCounts] = useState({});          // code -> {c,b,p}; row present = counted (loaded in loadDay)
  const [remarks, setRemarks] = useState({});        // code -> remark text
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [locked, setLocked] = useState(false);       // day locked after Save Day
  const setCount = (code, dim, val) => {
    setCounts((prev) => {
      const next = { ...prev, [code]: { ...(prev[code] || { c: 0, b: 0, p: 0 }), [dim]: val } };
      kvSetBg(countKey(wh, date), next);
      return next;
    });
  };
  const clearCount = (code) => {
    setCounts((prev) => {
      const next = { ...prev };
      delete next[code];
      kvSetBg(countKey(wh, date), next);
      return next;
    });
  };
  const setRemark = (code, text) => {
    setRemarks((prev) => {
      const next = { ...prev };
      if (text) next[code] = text; else delete next[code];
      kvSetBg(remarkKey(wh, date), next);
      return next;
    });
  };

  // ---- product master mutations (persist immediately) ----
  const updateProduct = (code, fields) => {
    setProducts((prev) => {
      const next = prev.map((p) => (p.code === code ? { ...p, ...fields } : p));
      kvSetBg(prodKey(wh), next);
      return next;
    });
  };

  // rename a product's code: master + per-SKU config + today's loaded data follow the new code.
  // (history saved under the old code on previous days stays there — rename soon after creating.)
  const renameProductCode = (oldCode, newCode) => {
    if (!newCode || newCode === oldCode) return;
    if (products.some((p) => p.code.toLowerCase() === newCode.toLowerCase() && p.code !== oldCode)) {
      alert(`Code "${newCode}" already exists.`);
      return;
    }
    setProducts((prev) => {
      const next = prev.map((p) => (p.code === oldCode ? { ...p, code: newCode } : p));
      kvSetBg(prodKey(wh), next);
      return next;
    });
    if (config.perSku[oldCode]) {
      const perSku = { ...config.perSku, [newCode]: config.perSku[oldCode] };
      delete perSku[oldCode];
      saveConfig({ ...config, perSku });
    }
    const moveKeyed = (obj) => {
      if (!(oldCode in obj)) return obj;
      const next = { ...obj, [newCode]: obj[oldCode] };
      delete next[oldCode];
      return next;
    };
    setOpening((o) => moveKeyed(o));
    setMoves((mv) => { const n = moveKeyed(mv); if (n !== mv) setSavedAt(null); return n; });
    setCounts((c) => { const n = moveKeyed(c); if (n !== c) kvSetBg(countKey(wh, date), n); return n; });
    setEditRow(newCode);
  };

  // ---- row-level edit mode in config (prevents accidental edits) ----
  const [editRow, setEditRow] = useState(null);          // product code being edited
  const [editPack, setEditPack] = useState({ boxes: 0, pcsOuter: 0 });
  const startEdit = (p) => {
    setEditRow(p.code);
    setEditPack({ boxes: p.pcsOuter > 0 ? Math.round(p.pcsCase / p.pcsOuter) : 0, pcsOuter: p.pcsOuter });
  };
  const changePack = (code, dim, val) => {
    const np = { ...editPack, [dim]: Math.max(0, val) };
    setEditPack(np);
    if (np.boxes > 0 && np.pcsOuter > 0) {
      updateProduct(code, { pcsOuter: np.pcsOuter, pcsCase: np.boxes * np.pcsOuter });
    }
  };
  const addProduct = (np) => {
    setProducts((prev) => {
      const next = [...prev, np];
      kvSetBg(prodKey(wh), next);
      return next;
    });
    // make its opening stock visible on the currently loaded day (raw C·B·P)
    if (np.openCase || np.openBox || np.openPcs)
      setOpening((prev) => ({ ...prev, [np.code]: { c: np.openCase || 0, b: np.openBox || 0, p: np.openPcs || 0 } }));
  };
  // ---- delete a product from this warehouse's master (admin only) ----
  const deleteProduct = (p) => {
    if (!isAdmin) return;
    if (!window.confirm(`Delete "${p.desc}" (${p.code}) from ${wh}? This removes it from the product list and its pricing. Past saved movements keep their record but the item won't appear going forward.`)) return;
    setProducts((prev) => {
      const next = prev.filter((x) => x.code !== p.code);
      kvSetBg(prodKey(wh), next);
      return next;
    });
    // drop its pricing overrides
    if (config.perSku[p.code]) {
      const perSku = { ...config.perSku };
      delete perSku[p.code];
      saveConfig({ ...config, perSku });
    }
    // drop from currently loaded day's opening view
    setOpening((prev) => { const n = { ...prev }; delete n[p.code]; return n; });
    if (editRow === p.code) setEditRow(null);
  };

  const [dbError, setDbError] = useState(null);
  const dateRef = useRef(null);
  useEffect(() => { onStorageError((msg) => setDbError(msg)); }, []);

  // ---- auth session ----
  const [session, setSession] = useState(undefined);   // undefined = still checking
  const [usersMap, setUsersMap] = useState({});         // email -> {role, warehouses}
  const [profile, setProfile] = useState(null);         // current user's entry
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    // only react to a genuine change of user — ignore TOKEN_REFRESHED / focus events,
    // which otherwise re-run the loader and reset the selected warehouse
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession((prev) => (prev?.user?.id === s?.user?.id ? prev : s));
    });
    return () => sub.subscription.unsubscribe();
  }, []);
  const myEmail = session?.user?.email?.toLowerCase() || null;
  const isAdmin = profile?.role === "admin";
  const signOut = () => supabase.auth.signOut();
  // once a day is saved it locks and no one edits it; only an admin can reopen it
  const canEdit = !locked;

  // ---- load products + warehouses + config + users after login ----
  useEffect(() => {
    if (!session) return;
    (async () => {
      setLoading(true);
      try {
        const m = await kvGetMany([K_WAREHOUSES, K_CONFIG, K_USERS]);
        let w = m[K_WAREHOUSES];
        if (!w) { w = WAREHOUSES_DEFAULT; kvSetBg(K_WAREHOUSES, w); }
        setWarehouses(w);
        const cfg = m[K_CONFIG];
        if (cfg) setConfig({ ...CONFIG_DEFAULT, ...cfg, perSku: cfg.perSku || {} });
        // users: first ever login becomes admin
        let u = m[K_USERS];
        const em = session.user.email.toLowerCase();
        if (!u) { u = { [em]: { role: "admin", warehouses: [] } }; await kvSet(K_USERS, u); }
        setUsersMap(u);
        const prof = u[em] || null;
        setProfile(prof);
        // initial warehouse = last used (if still allowed), else first accessible
        const allowed = prof?.role === "admin" ? w : w.filter((x) => (prof?.warehouses || []).includes(x));
        let last = null;
        try { last = localStorage.getItem("cad:lastwh"); } catch { /* ignore */ }
        setWh(allowed.includes(last) ? last : (allowed[0] || ""));
        setDbError(null);
      } catch (e) {
        setDbError(e.message || String(e));
      }
      setLoading(false);
    })();
  }, [session]);

  // warehouses this user can see
  const allowedWh = useMemo(() => {
    if (!profile) return [];
    return isAdmin ? warehouses : warehouses.filter((w) => (profile.warehouses || []).includes(w));
  }, [profile, isAdmin, warehouses]);

  const saveUsers = (next) => { setUsersMap(next); kvSetBg(K_USERS, next); };

  // ---- load this warehouse's product master (each warehouse has its own, from its sheet) ----
  useEffect(() => {
    if (!session || !profile || !wh) return;
    let alive = true;
    (async () => {
      setProducts(null); // pauses day-loading until master arrives
      try {
        const m = await kvGetMany([prodKey(wh)]);
        if (alive) setProducts(m[prodKey(wh)] || []);
      } catch (e) {
        setDbError(e.message || String(e));
        if (alive) setProducts([]);
      }
    })();
    return () => { alive = false; };
  }, [wh, session, profile]);

  // ---- load a warehouse-day (opening + movements + physical counts) ----
  // Opening = this day's snapshot if saved; otherwise walk back through up to 62
  // previous days, take the nearest saved opening, and roll every saved day's
  // movements forward — so closing always carries to the next day, even across
  // gaps (Sundays, missed days) and even if "Save Day" wasn't pressed yet today.
  const loadDay = useCallback(async (whName, d, prods) => {
    if (!prods) return;
    try {
      const [m, open] = await Promise.all([
        kvGetMany([mvKey(whName, d), countKey(whName, d), remarkKey(whName, d), lockKey(whName, d)]),
        resolveOpening(whName, d, prods),
      ]);
      setOpening(open);
      setMoves(m[mvKey(whName, d)] || {});
      setCounts(m[countKey(whName, d)] || {});
      setRemarks(m[remarkKey(whName, d)] || {});
      setLocked(!!m[lockKey(whName, d)]);
      setDbError(null);
    } catch (e) {
      setDbError(e.message || String(e));
    }
  }, []);

  useEffect(() => { if (products) loadDay(wh, date, products); }, [wh, date, products, loadDay]);

  const prodByCode = useMemo(() => {
    const m = {}; (products || []).forEach((p) => (m[p.code] = p)); return m;
  }, [products]);

  // ---- closing per product (C·B·P, component-wise, with minimum borrow for display) ----
  const closingCBP = useCallback((code) => {
    return borrow(computeClosing(opening[code] || { ...ZERO }, moves[code]), prodByCode[code]);
  }, [opening, moves, prodByCode]);
  // total pcs of closing (for valuation / negative checks) — borrow keeps the total identical
  const closingPcs = useCallback((code) => {
    const pr = prodByCode[code]; if (!pr) return 0;
    return cbpPcs(closingCBP(code), pr);
  }, [closingCBP, prodByCode]);
  // opening as C·B·P (borrowed for display) and its total pcs
  const openCBP = useCallback((code) => borrow(opening[code] || { ...ZERO }, prodByCode[code]), [opening, prodByCode]);
  const openPcs = useCallback((code) => {
    const pr = prodByCode[code]; if (!pr) return 0;
    return cbpPcs(openCBP(code), pr);
  }, [openCBP, prodByCode]);

  // ---- update a single cell (auto-saved immediately, so nothing is lost on
  // reload / minimize / date switch; Save Day then just locks the day) ----
  const setCell = (code, moveKey, dim, val) => {
    setMoves((prev) => {
      const next = { ...prev };
      const row = { ...(next[code] || {}) };
      const cell = { ...(row[moveKey] || { c: 0, b: 0, p: 0 }) };
      cell[dim] = val;
      row[moveKey] = cell;
      next[code] = row;
      kvSetBg(mvKey(wh, date), next);
      return next;
    });
    setSavedAt(new Date());
  };

  // delete stale opening snapshots after a given date so they get recomputed
  // from the carry-forward chain (a past day changed → old stamps are wrong)
  const invalidateAfter = async (whName, afterDate) => {
    const all = await kvGetLike(`cad:open:${whName}:%`);
    const stale = all.map((r) => r.key).filter((k) => k.slice(-10) > afterDate);
    await kvDeleteMany(stale);
  };

  // ---- save day ----
  // Only the day's movements are saved. Openings are never stamped per-day:
  // every day's opening is computed live from the uploaded opening snapshot
  // plus all saved movements since — so the chain can never go stale.
  const save = async () => {
    setSaving(true);
    try {
      // persist movements, counts and remarks, then lock the day
      await Promise.all([
        kvSet(mvKey(wh, date), moves),
        kvSet(countKey(wh, date), counts),
        kvSet(remarkKey(wh, date), remarks),
        kvSet(lockKey(wh, date), { by: myEmail, at: new Date().toISOString() }),
      ]);
      setLocked(true);
      setSavedAt(new Date());
      setDbError(null);
    } catch (e) {
      setDbError("Save failed: " + (e.message || e));
    }
    setSaving(false);
  };

  // ---- admin: reopen a locked day for editing ----
  const reopenDay = async () => {
    if (!window.confirm(`Reopen ${fmtDate(date)} for ${wh}? Staff will be able to edit this day again.`)) return;
    setSaving(true);
    try {
      await kvDeleteMany([lockKey(wh, date)]);
      setLocked(false);
      setSavedAt(null);
      setDbError(null);
    } catch (e) {
      setDbError("Reopen failed: " + (e.message || e));
    }
    setSaving(false);
  };

  // ---- shared MRP column filter (Excel-style, used on every product table) ----
  const [mrpSel, setMrpSel] = useState(null);        // array of MRP strings, or null = all
  const [openMrpCol, setOpenMrpCol] = useState(null);
  const mrpValues = useMemo(
    () => [...new Set((products || []).map((p) => p.mrp))].sort((a, b) => a - b),
    [products]
  );
  const mrpMatch = (mrp) => !mrpSel || mrpSel.includes(String(mrp));
  const MrpFilterTh = ({ thClass }) => (
    <FilterTh label="MRP" col="mrp" thClass={thClass || "num"} values={mrpValues}
      selected={mrpSel} openCol={openMrpCol} setOpenCol={setOpenMrpCol} onApply={setMrpSel} />
  );

  // ---- filtered rows (deferred query keeps typing responsive on large tables) ----
  const deferredQuery = useDeferredValue(query);
  const rows = useMemo(() => {
    if (!products) return [];
    const q = deferredQuery.trim().toLowerCase();
    return products.filter((p) => {
      if (q && !(p.desc.toLowerCase().includes(q) || p.code.toLowerCase().includes(q))) return false;
      if (mrpSel && !mrpSel.includes(String(p.mrp))) return false;
      if (!showZero && tab !== "config") {
        const hasMv = moves[p.code] && Object.values(moves[p.code]).some((c) => c && (c.c || c.b || c.p));
        const o = opening[p.code] || ZERO;
        if (!hasMv && !o.c && !o.b && !o.p) return false;
      }
      return true;
    });
  }, [products, deferredQuery, showZero, moves, opening, tab, mrpSel]);

  // ---- day totals ----
  const totals = useMemo(() => {
    let openVal = 0, closeVal = 0, openCost = 0, closeCost = 0;
    const mvTot = {}; MOVES.forEach((m) => (mvTot[m.key] = 0));
    (products || []).forEach((pr) => {
      const o = openPcs(pr.code), cl = closingPcs(pr.code);
      const cost = skuPricing(pr.mrp, config.perSku[pr.code] || {}, config.ourMargin).cost;
      openVal += o * pr.mrp;
      closeVal += cl * pr.mrp;
      openCost += o * cost;
      closeCost += cl * cost;
      const mv = moves[pr.code];
      if (mv) MOVES.forEach((m) => {
        const c = mv[m.key];
        if (c) mvTot[m.key] += toPcs(c.c, c.b, c.p, pr.pcsCase, pr.pcsOuter);
      });
    });
    return { openVal, closeVal, openCost, closeCost, mvTot };
  }, [products, openPcs, moves, closingPcs, config]);

  // ---- stock-take summary ----
  const stTotals = useMemo(() => {
    let counted = 0, matched = 0, short = 0, excess = 0, shortPcs = 0, excessPcs = 0, diffVal = 0;
    (products || []).forEach((pr) => {
      const ct = counts[pr.code];
      if (!ct) return;
      counted++;
      const phys = toPcs(ct.c, ct.b, ct.p, pr.pcsCase, pr.pcsOuter);
      const d = phys - closingPcs(pr.code);
      if (d === 0) matched++;
      else if (d < 0) { short++; shortPcs += -d; }
      else { excess++; excessPcs += d; }
      diffVal += d * pr.mrp;
    });
    return { counted, matched, short, excess, shortPcs, excessPcs, diffVal };
  }, [products, counts, closingPcs]);

  // ---- dashboard data (per warehouse or consolidated) ----
  const [dashWh, setDashWh] = useState("ALL");
  const [dash, setDash] = useState(null);   // [{w, ...agg}]
  useEffect(() => {
    if (tab !== "dashboard" || !profile || allowedWh.length === 0) return;
    const targets = dashWh === "ALL" ? allowedWh : allowedWh.includes(dashWh) ? [dashWh] : allowedWh;
    let alive = true;
    (async () => {
      setDash(null);
      try {
        // all warehouses fetched in parallel
        const results = await Promise.all(targets.map(async (w) => {
          const m = await kvGetMany([prodKey(w), mvKey(w, date)]);
          const prods = m[prodKey(w)] || [];
          const open = await resolveOpening(w, date, prods);
          return { w, ...aggWarehouse(prods, open, m[mvKey(w, date)] || {}, config) };
        }));
        if (alive) setDash(results);
      } catch (e) { setDbError(e.message || String(e)); if (alive) setDash([]); }
    })();
    return () => { alive = false; };
  }, [tab, dashWh, date, profile, allowedWh, config]);

  // ---- monthly report data ----
  const [month, setMonth] = useState(todayStr().slice(0, 7));
  const [monthly, setMonthly] = useState(null);  // {baseOpen, baseDate, sums, days}
  useEffect(() => {
    if (tab !== "monthly" || !products || !wh) return;
    let alive = true;
    (async () => {
      setMonthly(null);
      try {
        const baseDate = `${month}-01`;
        const [mvRows, baseOpen] = await Promise.all([
          kvGetLike(`cad:mv:${wh}:${month}-%`),
          resolveOpening(wh, baseDate, products),   // opening as on the 1st, computed live
        ]);
        if (!alive) return;
        const sums = {}; const days = new Set();
        mvRows.forEach((r) => {
          const d = r.key.slice(-10);
          days.add(d);
          Object.entries(r.value || {}).forEach(([code, mv]) => {
            const p = prodByCode[code];
            if (!p || !mv) return;
            // accumulate movement quantities per unit (Case/Box/Pcs) across the month
            if (!sums[code]) { sums[code] = {}; MOVES.forEach((m) => (sums[code][m.key] = { c: 0, b: 0, p: 0 })); }
            MOVES.forEach((m) => {
              const c = mv[m.key];
              if (c) { sums[code][m.key].c += c.c || 0; sums[code][m.key].b += c.b || 0; sums[code][m.key].p += c.p || 0; }
            });
          });
        });
        setMonthly({ baseOpen, baseDate, sums, days: days.size });
      } catch (e) { setDbError(e.message || String(e)); if (alive) setMonthly({ baseOpen: {}, baseDate: null, sums: {}, days: 0 }); }
    })();
    return () => { alive = false; };
  }, [tab, wh, month, products, prodByCode]);

  // ---- P&L data (day uses loaded moves; month aggregates saved days) ----
  const [plMode, setPlMode] = useState("day");
  const [plMonth, setPlMonth] = useState(todayStr().slice(0, 7));
  const [plSums, setPlSums] = useState(null);   // month mode: code -> {out, whole}
  useEffect(() => {
    if (tab !== "pl" || plMode !== "month" || !products || !wh) return;
    let alive = true;
    (async () => {
      setPlSums(null);
      try {
        const mvRows = await kvGetLike(`cad:mv:${wh}:${plMonth}-%`);
        if (!alive) return;
        const sums = {};
        mvRows.forEach((r) => Object.entries(r.value || {}).forEach(([code, mv]) => {
          const p = prodByCode[code];
          if (!p || !mv) return;
          if (!sums[code]) sums[code] = { out: 0, whole: 0 };
          ["out", "whole"].forEach((k) => { const c = mv[k]; if (c) sums[code][k] += toPcs(c.c, c.b, c.p, p.pcsCase, p.pcsOuter); });
        }));
        setPlSums(sums);
      } catch (e) { setDbError(e.message || String(e)); if (alive) setPlSums({}); }
    })();
    return () => { alive = false; };
  }, [tab, plMode, plMonth, wh, products, prodByCode]);

  // ---- opening stock upload (admin) ----
  const [showUpload, setShowUpload] = useState(false);
  const applyOpening = async (asOn, openMap, newProds, updates, cfgUpdates) => {
    let next = products || [];
    if (newProds.length || Object.keys(updates).length) {
      next = next.map((p) => (updates[p.code] ? { ...p, ...updates[p.code] } : p));
      next = [...next, ...newProds];
      setProducts(next);
      await kvSet(prodKey(wh), next);
    }
    if (cfgUpdates && Object.keys(cfgUpdates).length) {
      const perSku = { ...config.perSku };
      Object.entries(cfgUpdates).forEach(([code, c]) => { perSku[code] = { ...(perSku[code] || {}), ...c }; });
      saveConfig({ ...config, perSku });
    }
    // MERGE into any existing opening snapshot for that date — so products in the
    // sheet are updated/added, and products NOT in the sheet keep their opening
    const existing = (await kvGetMany([openKey(wh, asOn)]))[openKey(wh, asOn)] || {};
    const merged = { ...existing, ...openMap };
    await kvSet(openKey(wh, asOn), merged);
    // a fresh opening invalidates every later stamped opening for this warehouse
    await invalidateAfter(wh, asOn);
    if (asOn === date) { setOpening(merged); }
    else loadDay(wh, date, next);
    alert(`${wh}: ${newProds.length} new product(s) added, ${Object.keys(updates).length} updated, opening set as on ${fmtDate(asOn)} for ${Object.keys(openMap).length} product(s).`);
  };

  // ---- export all tabs to one Excel workbook ----
  const exportAll = () => {
    const wb = XLSX.utils.book_new();
    const ps = products || [];
    const mvPcs = (p, key) => {
      const c = (moves[p.code] || {})[key];
      return c ? toPcs(c.c, c.b, c.p, p.pcsCase, p.pcsOuter) : 0;
    };
    const cbpStr = (x) => `${x.c}·${x.b}·${x.p}`;   // raw, as entered

    // Stock Report
    const rep = [["Code", "Product", "MRP", "Opening C·B·P", "Opening Pcs", ...MOVES.map((m) => m.label + " Pcs"), "Closing C·B·P", "Closing Pcs", "Physical Pcs", "Diff Pcs", "Stock Value (Cost ex-GST)"]];
    ps.forEach((p) => {
      const oCBP = openCBP(p.code), o = openPcs(p.code), cl = closingPcs(p.code);
      const ct = counts[p.code];
      const phys = ct ? toPcs(ct.c, ct.b, ct.p, p.pcsCase, p.pcsOuter) : "";
      const cost = skuPricing(p.mrp, config.perSku[p.code] || {}, config.ourMargin).cost;
      rep.push([p.code, p.desc, p.mrp, cbpStr(oCBP), o, ...MOVES.map((m) => mvPcs(p, m.key)), cbpStr(closingCBP(p.code)), cl, phys, ct ? phys - cl : "", +(cl * cost).toFixed(2)]);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rep), "Stock Report");

    // Daily Entry (raw C·B·P entries)
    const ent = [["Code", "Product", ...MOVES.flatMap((m) => [m.label + " Case", "Box", "Pcs"])]];
    ps.forEach((p) => {
      const mv = moves[p.code] || {};
      ent.push([p.code, p.desc, ...MOVES.flatMap((m) => { const c = mv[m.key] || {}; return [c.c || 0, c.b || 0, c.p || 0]; })]);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ent), "Daily Entry");

    // Stock Take
    const st = [["Code", "Product", "System C·B·P", "System Pcs", "Physical C·B·P", "Physical Pcs", "Diff Pcs", "Diff Value (MRP)", "Remarks"]];
    ps.forEach((p) => {
      const cl = closingPcs(p.code), ct = counts[p.code];
      const phys = ct ? toPcs(ct.c, ct.b, ct.p, p.pcsCase, p.pcsOuter) : null;
      st.push([p.code, p.desc, cbpStr(closingCBP(p.code)), cl, ct ? `${ct.c}·${ct.b}·${ct.p}` : "not counted", phys ?? "", ct ? phys - cl : "", ct ? (phys - cl) * p.mrp : "", remarks[p.code] || ""]);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(st), "Stock Take");

    // Configuration
    const cf = [["Code", "Product", "MRP", "Box/Case", "Pcs/Box", "Pcs/Case", "Margin", "GST %", "Retails", "RD", "Cost ex-GST", "WS %", "WS Rate", "Cost/Case", "Profit/Pc Retail", "Profit/Pc WS"]];
    ps.forEach((p) => {
      const cfg = config.perSku[p.code] || {};
      const pr = skuPricing(p.mrp, cfg, config.ourMargin);
      cf.push([p.code, p.desc, p.mrp, p.pcsOuter > 0 ? +(p.pcsCase / p.pcsOuter).toFixed(2) : "", p.pcsOuter, p.pcsCase,
        cfg.margin ?? SKU_DEFAULTS.margin, cfg.gst ?? SKU_DEFAULTS.gst, +pr.retail.toFixed(2), +pr.rd.toFixed(2), +pr.cost.toFixed(2),
        cfg.ws ?? SKU_DEFAULTS.ws, +pr.ws.toFixed(2), +(pr.cost * p.pcsCase).toFixed(2), +pr.profitR.toFixed(2), +pr.profitW.toFixed(2)]);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cf), "Configuration");

    XLSX.writeFile(wb, `StockLedger_${wh.replace(/[^\w]+/g, "_")}_${date}.xlsx`);
  };

  // ---- rename warehouse (admin): migrates all day-keys to the new name ----
  const [renaming, setRenaming] = useState(false);
  const renameWarehouse = async () => {
    const name = prompt(`Rename warehouse "${wh}" to:`, wh);
    if (!name || name === wh) return;
    if (warehouses.includes(name)) { alert("A warehouse with that name already exists."); return; }
    if (!window.confirm(`Rename "${wh}" → "${name}"? All its stock history moves with it.`)) return;
    setRenaming(true);
    try {
      for (const pre of ["cad:mv:", "cad:open:", "cad:count:"]) {
        const old = await kvGetLike(pre + wh + ":%");
        if (old.length) {
          await kvUpsertMany(old.map((r) => ({ key: pre + name + r.key.slice((pre + wh).length), value: r.value })));
          await kvDeleteMany(old.map((r) => r.key));
        }
      }
      // move this warehouse's product master too
      const pm = await kvGetMany([prodKey(wh)]);
      if (pm[prodKey(wh)]) {
        await kvSet(prodKey(name), pm[prodKey(wh)]);
        await kvDeleteMany([prodKey(wh)]);
      }
      const w = warehouses.map((x) => (x === wh ? name : x));
      setWarehouses(w); kvSetBg(K_WAREHOUSES, w);
      // update user allotments
      const nu = {};
      Object.entries(usersMap).forEach(([em, u]) => {
        nu[em] = { ...u, warehouses: (u.warehouses || []).map((x) => (x === wh ? name : x)) };
      });
      saveUsers(nu);
      setWh(name);
    } catch (e) {
      setDbError("Rename failed: " + (e.message || e));
    }
    setRenaming(false);
  };

  // ---- warehouse management ----
  const addWarehouse = async () => {
    const name = prompt("New warehouse name:");
    if (!name) return;
    if (warehouses.includes(name)) { alert("Already exists"); return; }
    const w = [...warehouses, name];
    setWarehouses(w); kvSetBg(K_WAREHOUSES, w); setWh(name);
  };

  if (session === undefined) return (
    <div style={{ padding: 40, fontFamily: "monospace", color: "#5b4a3a" }}>Checking session…</div>
  );
  if (!session) return <Login />;
  if (loading) return (
    <div style={{ padding: 40, fontFamily: "monospace", color: "#5b4a3a" }}>Loading stock data from cloud…</div>
  );
  if (!profile) return (
    <div className="wrap" style={{ display: "grid", placeItems: "center", minHeight: "100vh" }}>
      <style>{CSS}</style>
      <div className="loginbox" style={{ textAlign: "center" }}>
        <div className="title" style={{ color: "#2a2018" }}>No access</div>
        <p style={{ fontSize: 13, color: "#6b5a45" }}>
          Your account <b>{myEmail}</b> has no permissions yet.<br />Ask the administrator to add you in the Users tab.
        </p>
        <button className="save" onClick={signOut}>Sign Out</button>
      </div>
    </div>
  );
  if (!isAdmin && allowedWh.length === 0) return (
    <div className="wrap" style={{ display: "grid", placeItems: "center", minHeight: "100vh" }}>
      <style>{CSS}</style>
      <div className="loginbox" style={{ textAlign: "center" }}>
        <div className="title" style={{ color: "#2a2018" }}>No warehouse assigned</div>
        <p style={{ fontSize: 13, color: "#6b5a45" }}>Ask the administrator to allot you a warehouse.</p>
        <button className="save" onClick={signOut}>Sign Out</button>
      </div>
    </div>
  );

  const activeMv = MOVES.find((m) => m.key === activeMove);

  return (
    <div className="wrap">
      <style>{CSS}</style>

      {dbError && (
        <div className="dberr">
          ⚠ Database error: {dbError} — your last change may not be saved.
          <button className="ghost2" style={{ marginLeft: 10 }} onClick={() => window.location.reload()}>Reload</button>
        </div>
      )}

      {/* ===== top bar ===== */}
      <div className="topbar">
        <div className="brand">
          <div className="logo" aria-label="Anchor">⚓</div>
          <div>
            <div className="title">ANCHOR</div>
            <div className="sub">Kwality Ventures · Mondelez Distribution</div>
          </div>
        </div>
        <div className="controls">
          <select className="whsel" value={wh} title="Warehouse"
            onChange={(e) => { setWh(e.target.value); try { localStorage.setItem("cad:lastwh", e.target.value); } catch { /* ignore */ } e.target.blur(); }}
            onKeyDown={(e) => { if (e.altKey || e.metaKey || e.ctrlKey) e.preventDefault(); }}>
            {allowedWh.map((w) => <option key={w}>{w}</option>)}
          </select>
          {isAdmin && <button className="ghost icon" onClick={addWarehouse} title="Add warehouse">＋</button>}
          {isAdmin && <button className="ghost icon" onClick={renameWarehouse} disabled={renaming} title="Rename this warehouse">{renaming ? "…" : "✎"}</button>}
          <span className="sep" />
          <button className="ghost icon" onClick={() => setDate(addDays(date, -1))} title="Previous day">‹</button>
          <label className="datechip" title="Pick a date"
            onClick={() => { try { dateRef.current.showPicker(); } catch { dateRef.current.focus(); } }}>
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(date + "T00:00:00").getDay()]}, {fmtDate(date)}
            <input ref={dateRef} type="date" value={date} onChange={(e) => setDate(e.target.value)} className="dateinput" tabIndex={-1} />
          </label>
          <button className="ghost icon" onClick={() => setDate(addDays(date, +1))} title="Next day">›</button>
          {date !== todayStr() && <button className="ghost" onClick={() => setDate(todayStr())}>Today</button>}
          <span className="sep" />
          <button className="ghost" onClick={signOut} title={`${myEmail} (${isAdmin ? "admin" : "user"}) — sign out`}>
            {myEmail.split("@")[0]} ⏻
          </button>
        </div>
      </div>

      {/* ===== tabs ===== */}
      <div className="tabs">
        <button className={tab === "dashboard" ? "tab on" : "tab"} onClick={() => setTab("dashboard")}>Dashboard</button>
        <button className={tab === "entry" ? "tab on" : "tab"} onClick={() => setTab("entry")}>Daily Entry</button>
        <button className={tab === "stocktake" ? "tab on" : "tab"} onClick={() => setTab("stocktake")}>Stock Take</button>
        <button className={tab === "report" ? "tab on" : "tab"} onClick={() => setTab("report")}>Stock Report</button>
        <button className={tab === "monthly" ? "tab on" : "tab"} onClick={() => setTab("monthly")}>Monthly</button>
        <button className={tab === "pl" ? "tab on" : "tab"} onClick={() => setTab("pl")}>P&L</button>
        <button className={tab === "config" ? "tab on" : "tab"} onClick={() => setTab("config")}>Configuration</button>
        {isAdmin && <button className={tab === "users" ? "tab on" : "tab"} onClick={() => setTab("users")}>Users</button>}
        <div className="spacer" />
        <button className="ghost2" style={{ marginRight: 8 }} onClick={exportAll} title="Download all tabs as one Excel file">⬇ Export</button>
        {(tab === "entry" || tab === "stocktake") && (
          <div className="savebox">
            {locked
              ? <span className="lockpill" title={`Locked for ${fmtDate(date)}`}>🔒 Day locked</span>
              : <span className="saved">✓ auto-saved</span>}
            {locked && isAdmin && <button className="ghost2" onClick={reopenDay} disabled={saving}>Reopen day</button>}
            {!locked && <button className="save" onClick={save} disabled={saving} title="Lock this day so it can't be edited">{saving ? "Saving…" : "Save & Lock Day"}</button>}
          </div>
        )}
        {tab === "config" && <span className="saved" style={{ padding: "8px 0" }}>changes save automatically</span>}
      </div>

      {/* ===== dashboard ===== */}
      {tab === "dashboard" && (() => {
        const consolidated = dashWh === "ALL";
        const sum = (f) => (dash || []).reduce((a, x) => a + x[f], 0);
        const mvSum = (k) => (dash || []).reduce((a, x) => a + x.mvTot[k], 0);
        const mergeTop = (f, key) => (dash || []).flatMap((x) => x[f].map((t) => ({ ...t, w: x.w }))).sort((a, b) => b[key] - a[key]).slice(0, 5);
        const topOut = mergeTop("topOut", "out"), topVal = mergeTop("topVal", "val");
        return (
          <div className="report">
            <div className="toolbar" style={{ paddingBottom: 4 }}>
              <div className="ptitle" style={{ margin: 0, fontSize: 13, color: "#2a2018", fontWeight: 700 }}>
                {consolidated ? "All Warehouses · Consolidated" : dashWh} — {fmtDate(date)}
              </div>
              <div className="spacer" />
              {allowedWh.length > 1 && (
                <select value={dashWh} onChange={(e) => setDashWh(e.target.value)}
                  style={{ padding: "7px 10px", borderRadius: 7, border: "1px solid #d2c2a8", background: "#fff", fontSize: 13 }}>
                  <option value="ALL">All warehouses (consolidated)</option>
                  {allowedWh.map((w) => <option key={w} value={w}>{w}</option>)}
                </select>
              )}
            </div>
            {!dash ? <div className="hint">Loading dashboard…</div> : (
              <>
                <div className="rcards">
                  <div className="rcard"><div className="rl">Closing Stock Value (MRP)</div><div className="rv">{inr(sum("closeVal"))}</div></div>
                  <div className="rcard"><div className="rl">Stock Value at Cost</div><div className="rv">{inr(sum("costVal"))}</div></div>
                  <div className="rcard"><div className="rl">Opening Value</div><div className="rv sm" style={{ fontSize: 18 }}>{inr(sum("openVal"))}</div></div>
                  <div className="rcard"><div className="rl">SKUs in Stock</div><div className="rv">{sum("withStock")}<span className="rsub"> / {sum("total")}</span></div></div>
                  <div className="rcard"><div className="rl">Negative Stock Items</div><div className="rv" style={{ color: sum("neg") > 0 ? "#b3261e" : "#1b7f4d" }}>{sum("neg")}</div></div>
                </div>
                <div className="rcards" style={{ paddingTop: 0 }}>
                  {MOVES.map((m) => (
                    <div className="rcard" key={m.key}><div className="rl">{m.label} (pcs)</div><div className="rv sm" style={{ color: m.color, fontSize: 20 }}>{mvSum(m.key)}</div></div>
                  ))}
                </div>
                <div className="panelgrid">
                  <div className="panel">
                    <div className="ptitle">Top 5 — Today's Stock Out</div>
                    {topOut.length === 0 && <div className="dim" style={{ fontSize: 12 }}>No outward movement today.</div>}
                    {topOut.map((t) => (
                      <div className="prow" key={t.w + t.code}>
                        <span>{t.desc}{consolidated && <span className="dim"> · {t.w}</span>}</span><b>{t.out} pcs</b>
                      </div>
                    ))}
                  </div>
                  <div className="panel">
                    <div className="ptitle">Top 5 — Holdings by Value (MRP)</div>
                    {topVal.map((t) => (
                      <div className="prow" key={t.w + t.code}>
                        <span>{t.desc}{consolidated && <span className="dim"> · {t.w}</span>}</span><b>{inr(t.val)}</b>
                      </div>
                    ))}
                  </div>
                  {consolidated && dash.length > 1 && (
                    <div className="panel">
                      <div className="ptitle">By Warehouse</div>
                      {dash.map((x) => (
                        <div className="prow" key={x.w}>
                          <span>{x.w}<span className="dim"> · in {x.mvTot.in} / out {x.mvTot.out + x.mvTot.whole + x.mvTot.retail} pcs</span></span>
                          <b>{inr(x.closeVal)}</b>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        );
      })()}

      {/* ===== monthly report ===== */}
      {tab === "monthly" && (
        <div className="report">
          <div className="toolbar" style={{ paddingBottom: 4 }}>
            <div className="ptitle" style={{ margin: 0, fontSize: 13, color: "#2a2018", fontWeight: 700 }}>
              Monthly Movement — {wh}
            </div>
            <div className="spacer" />
            <input className="search" style={{ flex: "0 1 260px" }} placeholder="Search product or code…" value={query} onChange={(e) => setQuery(e.target.value)} />
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
              style={{ padding: "7px 10px", borderRadius: 7, border: "1px solid #d2c2a8", background: "#fff", fontSize: 13 }} />
          </div>
          {!monthly ? <div className="hint">Loading month…</div> : (() => {
            const ps = products || [];
            const ql = query.trim().toLowerCase();
            const rowsM = ps.map((p) => {
              const oCBP = monthly.baseOpen[p.code] || { ...ZERO };
              const s = monthly.sums[p.code] || {};
              // net and closing computed per unit (Case/Box/Pcs), no re-bundling
              const netCBP = { ...ZERO };
              MOVES.forEach((m) => { const c = s[m.key]; if (c) { netCBP.c += m.sign * c.c; netCBP.b += m.sign * c.b; netCBP.p += m.sign * c.p; } });
              const clCBP = { c: oCBP.c + netCBP.c, b: oCBP.b + netCBP.b, p: oCBP.p + netCBP.p };
              const o = cbpPcs(oCBP, p), net = cbpPcs(netCBP, p), cl = cbpPcs(clCBP, p);
              const movedAny = MOVES.some((m) => s[m.key] && (s[m.key].c || s[m.key].b || s[m.key].p));
              return { p, oCBP, s, netCBP, clCBP, o, net, cl, movedAny };
            }).filter((r) => r.oCBP.c || r.oCBP.b || r.oCBP.p || r.movedAny)
              .filter((r) => mrpMatch(r.p.mrp))
              .filter((r) => !ql || r.p.desc.toLowerCase().includes(ql) || r.p.code.toLowerCase().includes(ql));
            const tot = (f) => rowsM.reduce((a, r) => a + (r.s[f] ? toPcs(r.s[f].c, r.s[f].b, r.s[f].p, r.p.pcsCase, r.p.pcsOuter) : 0), 0);
            return (
              <>
                <div className="hint" style={{ paddingTop: 6 }}>
                  Opening as on {monthly.baseDate ? fmtDate(monthly.baseDate) : "—"} · {monthly.days} day(s) with saved entries this month · showing products with stock or movement.
                </div>
                <div className="gridwrap" style={openMrpCol ? { minHeight: 460 } : undefined}>
                  {openMrpCol && <div className="hfback" onClick={() => setOpenMrpCol(null)} />}
                  <table className="grid">
                    <thead>
                      <tr>
                        <th className="stick code">Code</th>
                        <th className="stick desc">Product</th>
                        <MrpFilterTh />
                        <th className="grp">Opening<br /><span>C · B · P</span></th>
                        <th className="num">Opening Pcs</th>
                        {MOVES.map((m) => <th key={m.key} className="num" style={{ color: m.color }}>{m.label}</th>)}
                        <th className="num">Net Pcs</th>
                        <th className="grp closing">Closing C·B·P</th>
                        <th className="num closing">Closing Pcs</th>
                        <th className="num">Stock Value<br /><span>Cost ex-GST</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rowsM.map(({ p, oCBP, s, net, cl, clCBP }) => {
                        const cd = borrow(clCBP, p), od = borrow(oCBP, p);
                        const cost = skuPricing(p.mrp, config.perSku[p.code] || {}, config.ourMargin).cost;
                        return (
                          <tr key={p.code} className={cl < 0 ? "rneg" : ""}>
                            <td className="stick code mono">{p.code}</td>
                            <td className="stick desc">{p.desc}</td>
                            <td className="num dim">{p.mrp}</td>
                            <td className="cbp">{od.c}·{od.b}·{od.p}</td>
                            <td className="num dim">{cbpPcs(od, p)}</td>
                            {MOVES.map((m) => { const c = s[m.key]; const t = c ? toPcs(c.c, c.b, c.p, p.pcsCase, p.pcsOuter) : 0; return <td key={m.key} className="num dim">{t || ""}</td>; })}
                            <td className={"num " + (net < 0 ? "negtxt" : net > 0 ? "oktxt" : "dim")}>{net !== 0 ? (net > 0 ? "+" : "") + net : ""}</td>
                            <td className={"cbp closing" + (cl < 0 ? " negtxt" : "")}>{cd.c}·{cd.b}·{cd.p}</td>
                            <td className={"num closing" + (cl < 0 ? " negtxt" : "")}>{cl}</td>
                            <td className="num">{inr(cl * cost)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      {(() => {
                        const t = { open: 0, net: 0, cl: 0, val: 0 };
                        rowsM.forEach((r) => {
                          const cost = skuPricing(r.p.mrp, config.perSku[r.p.code] || {}, config.ourMargin).cost;
                          t.open += r.o; t.net += r.net; t.cl += r.cl; t.val += r.cl * cost;
                        });
                        return (
                          <tr className="trow">
                            <td className="stick code">TOTAL</td>
                            <td className="stick desc">{rowsM.length} products</td>
                            <td></td>
                            <td></td>
                            <td className="num">{t.open}</td>
                            {MOVES.map((m) => <td key={m.key} className="num" style={{ color: m.color }}>{tot(m.key) || ""}</td>)}
                            <td className={"num " + (t.net < 0 ? "negtxt" : t.net > 0 ? "oktxt" : "")}>{t.net !== 0 ? (t.net > 0 ? "+" : "") + t.net : ""}</td>
                            <td></td>
                            <td className="num">{t.cl}</td>
                            <td className="num">{inr(t.val)}</td>
                          </tr>
                        );
                      })()}
                    </tfoot>
                  </table>
                </div>
                <div className="footbar">
                  <div><b>{rowsM.length}</b> products with stock/movement</div>
                  <div className="ftot">
                    {MOVES.map((m) => <span key={m.key} style={{ color: m.color }}>{m.label}: <b>{tot(m.key)}</b> pcs</span>)}
                  </div>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* ===== P&L statement ===== */}
      {tab === "pl" && (
        <div className="report">
          <div className="toolbar" style={{ paddingBottom: 4 }}>
            <div className="ptitle" style={{ margin: 0, fontSize: 13, color: "#2a2018", fontWeight: 700 }}>
              P&L — {wh} · {plMode === "day" ? fmtDate(date) : plMonth}
            </div>
            <div className="spacer" />
            <div className="movepick">
              <button className={plMode === "day" ? "mp on" : "mp"} style={plMode === "day" ? { background: "#6b1f24", borderColor: "#6b1f24" } : { color: "#6b1f24", borderColor: "#6b1f24" }} onClick={() => setPlMode("day")}>Day</button>
              <button className={plMode === "month" ? "mp on" : "mp"} style={plMode === "month" ? { background: "#6b1f24", borderColor: "#6b1f24" } : { color: "#6b1f24", borderColor: "#6b1f24" }} onClick={() => setPlMode("month")}>Month</button>
            </div>
            {plMode === "day" && (
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                style={{ padding: "7px 10px", borderRadius: 7, border: "1px solid #d2c2a8", background: "#fff", fontSize: 13 }} />
            )}
            {plMode === "month" && (
              <input type="month" value={plMonth} onChange={(e) => setPlMonth(e.target.value)}
                style={{ padding: "7px 10px", borderRadius: 7, border: "1px solid #d2c2a8", background: "#fff", fontSize: 13 }} />
            )}
          </div>
          {plMode === "month" && !plSums ? <div className="hint">Loading month…</div> : (() => {
            // qty sold per product: day mode reads today's loaded movements; month mode uses aggregated sums
            const qty = (p) => {
              if (plMode === "day") {
                const mv = moves[p.code] || {};
                const t = (k) => { const c = mv[k]; return c ? toPcs(c.c, c.b, c.p, p.pcsCase, p.pcsOuter) : 0; };
                return { r: t("out"), w: t("whole") };
              }
              const s = plSums[p.code] || {};
              return { r: s.out || 0, w: s.whole || 0 };
            };
            const rowsP = (products || []).map((p) => {
              const q = qty(p);
              if (!q.r && !q.w) return null;
              const pr = skuPricing(p.mrp, config.perSku[p.code] || {}, config.ourMargin);
              return {
                p, qR: q.r, qW: q.w, pr,
                revR: q.r * pr.retailNet, revW: q.w * pr.wsNet,
                costR: q.r * pr.cost, costW: q.w * pr.cost,
                profR: q.r * pr.profitR, profW: q.w * pr.profitW,
              };
            }).filter(Boolean).filter((r) => mrpMatch(r.p.mrp)).filter((r) => {
              const ql = query.trim().toLowerCase();
              return !ql || r.p.desc.toLowerCase().includes(ql) || r.p.code.toLowerCase().includes(ql);
            });
            const T = rowsP.reduce((a, r) => ({
              qR: a.qR + r.qR, qW: a.qW + r.qW, revR: a.revR + r.revR, revW: a.revW + r.revW,
              costR: a.costR + r.costR, costW: a.costW + r.costW,
              profR: a.profR + r.profR, profW: a.profW + r.profW,
            }), { qR: 0, qW: 0, revR: 0, revW: 0, costR: 0, costW: 0, profR: 0, profW: 0 });
            return (
              <>
                <div className="rcards">
                  <div className="rcard"><div className="rl">Retail Sales (Stock Out)</div><div className="rv sm" style={{ fontSize: 17 }}>{inr(T.revR)}<span className="rsub"> · {T.qR} pcs</span></div></div>
                  <div className="rcard"><div className="rl">Retail Cost</div><div className="rv sm" style={{ fontSize: 17 }}>{inr(T.costR)}</div></div>
                  <div className="rcard"><div className="rl">Retail Profit</div><div className="rv sm" style={{ fontSize: 17, color: "#1b7f4d" }}>{inr(T.profR)}</div></div>
                  <div className="rcard"><div className="rl">Wholesale Sales</div><div className="rv sm" style={{ fontSize: 17 }}>{inr(T.revW)}<span className="rsub"> · {T.qW} pcs</span></div></div>
                  <div className="rcard"><div className="rl">Wholesale Cost</div><div className="rv sm" style={{ fontSize: 17 }}>{inr(T.costW)}</div></div>
                  <div className="rcard"><div className="rl">Wholesale Profit</div><div className="rv sm" style={{ fontSize: 17, color: T.profW < 0 ? "#b3261e" : "#1b7f4d" }}>{inr(T.profW)}</div></div>
                  <div className="rcard"><div className="rl">Total Profit</div><div className="rv" style={{ color: T.profR + T.profW < 0 ? "#b3261e" : "#1b7f4d" }}>{inr(T.profR + T.profW)}</div></div>
                </div>
                <div className="toolbar" style={{ paddingTop: 0 }}>
                  <input className="search" placeholder="Search product or code…" value={query} onChange={(e) => setQuery(e.target.value)} />
                </div>
                <div className="hint" style={{ paddingTop: 0 }}>
                  Sales Value, Cost Value and Profit are all <b>ex-GST</b> (Sales − Cost = Profit exactly). Rate columns show the billing rate incl GST.
                  Edit/Cancel and Retail Extra are not counted. Showing only items sold.
                </div>
                <div className="gridwrap" style={openMrpCol ? { minHeight: 460 } : undefined}>
                  {openMrpCol && <div className="hfback" onClick={() => setOpenMrpCol(null)} />}
                  <table className="grid">
                    <thead>
                      <tr>
                        <th className="stick code">Code</th>
                        <th className="stick desc">Product</th>
                        <MrpFilterTh />
                        <th className="num" style={{ color: "#b3261e" }}>Retail Qty</th>
                        <th className="num">Rate</th>
                        <th className="num">Sales Value</th>
                        <th className="num">Cost Value</th>
                        <th className="num">Profit/Pc</th>
                        <th className="num closing">Retail Profit</th>
                        <th className="num" style={{ color: "#8a5a00" }}>WS Qty</th>
                        <th className="num">Rate</th>
                        <th className="num">Sales Value</th>
                        <th className="num">Cost Value</th>
                        <th className="num">Profit/Pc</th>
                        <th className="num closing">WS Profit</th>
                        <th className="num">Total Profit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rowsP.map((r) => (
                        <tr key={r.p.code}>
                          <td className="stick code mono">{r.p.code}</td>
                          <td className="stick desc">{r.p.desc}</td>
                          <td className="num dim">{r.p.mrp}</td>
                          <td className="num">{r.qR || ""}</td>
                          <td className="num dim">{r.qR ? r.pr.retail.toFixed(2) : ""}</td>
                          <td className="num">{r.qR ? inr(r.revR) : ""}</td>
                          <td className="num dim">{r.qR ? inr(r.costR) : ""}</td>
                          <td className="num dim">{r.qR ? r.pr.profitR.toFixed(2) : ""}</td>
                          <td className="num closing">{r.qR ? inr(r.profR) : ""}</td>
                          <td className="num">{r.qW || ""}</td>
                          <td className="num dim">{r.qW ? r.pr.ws.toFixed(2) : ""}</td>
                          <td className="num">{r.qW ? inr(r.revW) : ""}</td>
                          <td className="num dim">{r.qW ? inr(r.costW) : ""}</td>
                          <td className="num dim">{r.qW ? r.pr.profitW.toFixed(2) : ""}</td>
                          <td className="num closing">{r.qW ? inr(r.profW) : ""}</td>
                          <td className="num"><b>{inr(r.profR + r.profW)}</b></td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="trow">
                        <td className="stick code">TOTAL</td>
                        <td className="stick desc">{rowsP.length} items sold</td>
                        <td></td>
                        <td className="num">{T.qR}</td>
                        <td></td>
                        <td className="num">{inr(T.revR)}</td>
                        <td className="num">{inr(T.costR)}</td>
                        <td></td>
                        <td className="num">{inr(T.profR)}</td>
                        <td className="num">{T.qW}</td>
                        <td></td>
                        <td className="num">{inr(T.revW)}</td>
                        <td className="num">{inr(T.costW)}</td>
                        <td></td>
                        <td className="num">{inr(T.profW)}</td>
                        <td className="num">{inr(T.profR + T.profW)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* ===== entry ===== */}
      {tab === "entry" && (
        <>
          <div className="toolbar">
            <input className="search" placeholder="Search product or code…" value={query} onChange={(e) => setQuery(e.target.value)} />
            <div className="movepick">
              {MOVES.map((m) => (
                <button key={m.key}
                  className={activeMove === m.key ? "mp on" : "mp"}
                  style={activeMove === m.key ? { background: m.color, borderColor: m.color } : { color: m.color, borderColor: m.color }}
                  onClick={() => setActiveMove(m.key)}>
                  {m.label}
                </button>
              ))}
            </div>
            <label className="zt">
              <input type="checkbox" checked={showZero} onChange={(e) => setShowZero(e.target.checked)} />
              show all
            </label>
          </div>

          <div className="hint">
            {(products || []).length === 0
              ? <b>No products in {wh} yet — go to Configuration → ⬆ Upload Opening Stock to load this warehouse's sheet.</b>
              : <>Type into <b style={{ color: activeMv.color }}>{activeMv.label}</b> — columns are <b>Case · Box · Pcs</b>.
                Closing carries to tomorrow's opening automatically. Switch movement type with the colored buttons.</>}
          </div>

          <div className="gridwrap" style={openMrpCol ? { minHeight: 460 } : undefined}>
            {openMrpCol && <div className="hfback" onClick={() => setOpenMrpCol(null)} />}
            <table className="grid">
              <thead>
                <tr>
                  <th className="stick code">Code</th>
                  <th className="stick desc">Product</th>
                  <MrpFilterTh />
                  <th className="grp">Opening<br /><span>C · B · P</span></th>
                  <th className="num">Open<br /><span>Pcs</span></th>
                  <th className="grp" style={{ color: activeMv.color }}>{activeMv.label}<br /><span>Case</span></th>
                  <th className="grp" style={{ color: activeMv.color }}><br /><span>Box</span></th>
                  <th className="grp" style={{ color: activeMv.color }}><br /><span>Pcs</span></th>
                  <th className="num" style={{ color: activeMv.color }}>Total<br /><span>Pcs</span></th>
                  <th className="grp closing">Closing<br /><span>C · B · P</span></th>
                  <th className="num closing">Close<br /><span>Pcs</span></th>
                  <th className="num">Value</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const od = openCBP(p.code);
                  const o = openPcs(p.code);
                  const cd = closingCBP(p.code);
                  const cl = closingPcs(p.code);
                  const cell = (moves[p.code] && moves[p.code][activeMove]) || { c: 0, b: 0, p: 0 };
                  const neg = cl < 0;
                  return (
                    <tr key={p.code} className={neg ? "rneg" : ""}>
                      <td className="stick code mono">{p.code}</td>
                      <td className="stick desc">{p.desc}</td>
                      <td className="num dim">{p.mrp}</td>
                      <td className="cbp">{od.c}·{od.b}·{od.p}</td>
                      <td className="num dim">{o}</td>
                      <td className="inp"><NumCell value={cell.c} accent={activeMv.color} disabled={!canEdit} onChange={(v) => setCell(p.code, activeMove, "c", v)} /></td>
                      <td className="inp"><NumCell value={cell.b} accent={activeMv.color} disabled={!canEdit} onChange={(v) => setCell(p.code, activeMove, "b", v)} /></td>
                      <td className="inp"><NumCell value={cell.p} accent={activeMv.color} disabled={!canEdit} onChange={(v) => setCell(p.code, activeMove, "p", v)} /></td>
                      <td className="num" style={{ color: activeMv.color, fontWeight: 600 }}>{toPcs(cell.c, cell.b, cell.p, p.pcsCase, p.pcsOuter) || ""}</td>
                      <td className={"cbp closing" + (neg ? " negtxt" : "")}>{cd.c}·{cd.b}·{cd.p}</td>
                      <td className={"num closing" + (neg ? " negtxt" : "")}>{cl}</td>
                      <td className="num">{inr(cl * p.mrp)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="footbar">
            <div>Showing <b>{rows.length}</b> / {(products || []).length} products</div>
            <div className="ftot">
              {MOVES.map((m) => (
                <span key={m.key} style={{ color: m.color }}>{m.label}: <b>{totals.mvTot[m.key]}</b> pcs</span>
              ))}
            </div>
            <div>Opening <b>{inr(totals.openVal)}</b> → Closing <b>{inr(totals.closeVal)}</b></div>
          </div>
        </>
      )}

      {/* ===== stock take ===== */}
      {tab === "stocktake" && (
        <>
          <div className="rcards">
            <div className="rcard"><div className="rl">Counted</div><div className="rv">{stTotals.counted}<span className="rsub"> / {(products || []).length}</span></div></div>
            <div className="rcard"><div className="rl">Matched</div><div className="rv" style={{ color: "#1b7f4d" }}>{stTotals.matched}</div></div>
            <div className="rcard"><div className="rl">Short</div><div className="rv" style={{ color: "#b3261e" }}>{stTotals.short}<span className="rsub"> items · {stTotals.shortPcs} pcs</span></div></div>
            <div className="rcard"><div className="rl">Excess</div><div className="rv" style={{ color: "#8a5a00" }}>{stTotals.excess}<span className="rsub"> items · {stTotals.excessPcs} pcs</span></div></div>
            <div className="rcard"><div className="rl">Net Diff Value (MRP)</div><div className="rv" style={{ color: stTotals.diffVal < 0 ? "#b3261e" : stTotals.diffVal > 0 ? "#8a5a00" : "#1b7f4d" }}>{inr(stTotals.diffVal)}</div></div>
          </div>

          <div className="toolbar">
            <input className="search" placeholder="Search product or code…" value={query} onChange={(e) => setQuery(e.target.value)} />
            <label className="zt">
              <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} />
              only differences
            </label>
          </div>

          <div className="hint">
            Enter the <b>physical count</b> as Case · Box · Pcs after counting the warehouse. Diff = Physical − System Closing
            (closing includes all of today's In/Out/Wholesale/Retail/Edit). Untouched rows are treated as <b>not counted</b> — use ⟲ to un-count a row.
          </div>

          <div className="gridwrap" style={openMrpCol ? { minHeight: 460 } : undefined}>
            {openMrpCol && <div className="hfback" onClick={() => setOpenMrpCol(null)} />}
            <table className="grid">
              <thead>
                <tr>
                  <th className="stick code">Code</th>
                  <th className="stick desc">Product</th>
                  <MrpFilterTh />
                  <th className="grp closing">System Closing<br /><span>C · B · P</span></th>
                  <th className="num closing">Pcs</th>
                  <th className="grp" style={{ color: "#0a6e7a" }}>Physical<br /><span>Case</span></th>
                  <th className="grp" style={{ color: "#0a6e7a" }}><br /><span>Box</span></th>
                  <th className="grp" style={{ color: "#0a6e7a" }}><br /><span>Pcs</span></th>
                  <th className="num">Physical Pcs</th>
                  <th className="num">Diff Pcs</th>
                  <th className="grp">Diff<br /><span>C · B · P</span></th>
                  <th className="num">Diff ₹</th>
                  <th className="rmkhead">Remarks</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const cd = closingCBP(p.code);
                  const cl = closingPcs(p.code);
                  const ct = counts[p.code];
                  const phys = ct ? toPcs(ct.c, ct.b, ct.p, p.pcsCase, p.pcsOuter) : null;
                  const d = ct ? phys - cl : null;
                  if (onlyDiff && (d === null || d === 0)) return null;
                  // diff per-unit: physical C·B·P minus system closing C·B·P
                  const dd = ct ? { c: ct.c - cd.c, b: ct.b - cd.b, p: ct.p - cd.p } : null;
                  const cls = d === null ? "" : d === 0 ? "rok" : d < 0 ? "rneg" : "rexc";
                  return (
                    <tr key={p.code} className={cls}>
                      <td className="stick code mono">{p.code}</td>
                      <td className="stick desc">{p.desc}</td>
                      <td className="num dim">{p.mrp}</td>
                      <td className="cbp closing">{cd.c}·{cd.b}·{cd.p}</td>
                      <td className="num closing">{cl}</td>
                      <td className="inp"><NumCell value={ct ? ct.c : 0} accent="#0a6e7a" disabled={!canEdit} onChange={(v) => setCount(p.code, "c", v)} /></td>
                      <td className="inp"><NumCell value={ct ? ct.b : 0} accent="#0a6e7a" disabled={!canEdit} onChange={(v) => setCount(p.code, "b", v)} /></td>
                      <td className="inp"><NumCell value={ct ? ct.p : 0} accent="#0a6e7a" disabled={!canEdit} onChange={(v) => setCount(p.code, "p", v)} /></td>
                      <td className="num">{ct ? phys : "–"}</td>
                      <td className={"num " + (d === null ? "dim" : d < 0 ? "negtxt" : d > 0 ? "exctxt" : "oktxt")}>
                        {d === null ? "not counted" : d === 0 ? "✓ 0" : (d > 0 ? "+" : "") + d}
                      </td>
                      <td className="cbp">{ct && d !== 0 ? `${dd.c}·${dd.b}·${dd.p}` : ""}</td>
                      <td className={"num " + (d ? (d < 0 ? "negtxt" : "exctxt") : "dim")}>{ct && d !== 0 ? inr(d * p.mrp) : ""}</td>
                      <td className="rmkcell">
                        <textarea className="rmk" rows={1} value={remarks[p.code] || ""} disabled={!canEdit}
                          placeholder={canEdit ? "reason…" : ""}
                          onChange={(e) => { setRemark(p.code, e.target.value); e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; }}
                          ref={(el) => { if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; } }} />
                      </td>
                      <td className="inp">{ct && canEdit && <button className="unct" title="Clear count (mark not counted)" onClick={() => clearCount(p.code)}>⟲</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="footbar">
            <div>Showing <b>{rows.length}</b> / {(products || []).length} products</div>
            <div className="ftot">
              <span style={{ color: "#1b7f4d" }}>Matched: <b>{stTotals.matched}</b></span>
              <span style={{ color: "#b3261e" }}>Short: <b>{stTotals.shortPcs}</b> pcs</span>
              <span style={{ color: "#8a5a00" }}>Excess: <b>{stTotals.excessPcs}</b> pcs</span>
            </div>
            <div>Net diff <b style={{ color: stTotals.diffVal < 0 ? "#b3261e" : "#2a2018" }}>{inr(stTotals.diffVal)}</b> at MRP</div>
          </div>
        </>
      )}

      {/* ===== users (admin) ===== */}
      {tab === "users" && isAdmin && (
        <UsersPanel usersMap={usersMap} saveUsers={saveUsers} warehouses={warehouses} myEmail={myEmail} />
      )}

      {/* ===== configuration ===== */}
      {tab === "config" && (
        <>
          <div className="toolbar">
            <input className="search" placeholder="Search product or code…" value={query} onChange={(e) => setQuery(e.target.value)} />
            <label className="zt" title="Our fixed wholesaler margin, applied on the retail rate. RD = Retail ÷ (1 + this)">
              Our margin&nbsp;
              {isAdmin
                ? <DecCell value={config.ourMargin} suffix="%" onChange={(v) => saveConfig({ ...config, ourMargin: v })} />
                : <b>{config.ourMargin}%</b>}
            </label>
            {Object.values(cfgSel).some((v) => v != null) && (
              <button className="ghost2" onClick={() => setCfgSel({})}>✕ Clear filters</button>
            )}
            <button className="save" onClick={() => setShowAdd(!showAdd)}>{showAdd ? "✕ Close" : "＋ Add Product"}</button>
            {isAdmin && (
              <button className="ghost2" onClick={() => setShowUpload(!showUpload)}>
                {showUpload ? "✕ Close upload" : "⬆ Upload Opening Stock"}
              </button>
            )}
          </div>

          {showAdd && <AddProductPanel products={products} onAdd={addProduct} onClose={() => setShowAdd(false)} />}
          {showUpload && isAdmin && (
            <UploadOpeningPanel products={products} wh={wh} onApply={applyOpening} onClose={() => setShowUpload(false)} />
          )}

          <div className="hint">
            Rows are read-only — click <b>✎ Edit</b> at the end of a row to change
            {isAdmin ? <> code, name, MRP, Box/Case, Pcs/Box, Margin, GST % or WS %. <b>Pcs/Case is auto-calculated</b> (Box/Case × Pcs/Box).</>
              : <> the product <b>code and name</b> (other fields are admin-only).</>}
            {" "}Retails = MRP ÷ Margin · RD = Retails ÷ (1 + our %) · Cost = RD ÷ (1 + GST) — used for stock value.
          </div>

          {(() => {
            // excel-style column filters: value getters + distinct lists
            const getVal = {
              mrp: (p) => p.mrp,
              boxcase: (p) => (p.pcsOuter > 0 ? (p.pcsCase / p.pcsOuter).toFixed(1).replace(/\.0$/, "") : "–"),
              pcsbox: (p) => p.pcsOuter || "–",
              pcscase: (p) => p.pcsCase || "–",
              margin: (p) => config.perSku[p.code]?.margin ?? SKU_DEFAULTS.margin,
              gst: (p) => config.perSku[p.code]?.gst ?? SKU_DEFAULTS.gst,
              ws: (p) => config.perSku[p.code]?.ws ?? SKU_DEFAULTS.ws,
            };
            const distinct = (col) => [...new Set(rows.map(getVal[col]))].sort((a, b) =>
              (typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true })));
            const rowsC = rows.filter((p) =>
              Object.entries(cfgSel).every(([col, arr]) => arr == null || arr.includes(String(getVal[col](p)))));
            const fth = (label, sub, col, thClass) => (
              <FilterTh label={label} sub={sub} col={col} thClass={thClass} values={distinct(col)}
                selected={cfgSel[col] ?? null} openCol={cfgOpenF} setOpenCol={setCfgOpenF} onApply={setColFilter(col)} />
            );
            return (<>
          <div className="gridwrap" style={cfgOpenF ? { minHeight: 420 } : undefined}>
            {cfgOpenF && <div className="hfback" onClick={() => setCfgOpenF(null)} />}
            <table className="grid">
              <thead>
                <tr>
                  <th className="stick code">Code</th>
                  <th className="stick desc">Product</th>
                  {fth("MRP", null, "mrp")}
                  {fth("Box/Case", null, "boxcase")}
                  {fth("Pcs/Box", null, "pcsbox")}
                  {fth("Pcs/Case", "auto", "pcscase")}
                  {fth("Margin", null, "margin", "")}
                  {fth("GST %", null, "gst", "")}
                  <th className="num">Retails</th>
                  <th className="num">RD</th>
                  <th className="num closing">Cost ex-GST</th>
                  {fth("WS %", null, "ws", "")}
                  <th className="num">WS Rate</th>
                  <th className="num">Cost/Case</th>
                  <th className="num closing">Profit/Pc<br /><span>Retail</span></th>
                  <th className="num closing">Profit/Pc<br /><span>WS</span></th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rowsC.map((p) => {
                  const cfg = config.perSku[p.code] || {};
                  const pr = skuPricing(p.mrp, cfg, config.ourMargin);
                  const editing = editRow === p.code;
                  const boxesShow = p.pcsOuter > 0 ? (p.pcsCase / p.pcsOuter).toFixed(1).replace(/\.0$/, "") : "–";
                  return (
                    <tr key={p.code} className={editing ? "redit" : ""}>
                      <td className="stick code mono">
                        {editing ? <TextCell value={p.code} width={70} onCommit={(v) => renameProductCode(p.code, v)} /> : p.code}
                      </td>
                      <td className="stick desc">
                        {editing ? <TextCell value={p.desc} width={210} onCommit={(v) => { if (v) updateProduct(p.code, { desc: v }); }} /> : p.desc}
                      </td>
                      {editing && isAdmin ? (
                        <>
                          <td className="inp"><DecCell value={p.mrp} onChange={(v) => { if (v > 0) updateProduct(p.code, { mrp: v }); }} /></td>
                          <td className="inp"><NumCell value={editPack.boxes} onChange={(v) => changePack(p.code, "boxes", v)} /></td>
                          <td className="inp"><NumCell value={editPack.pcsOuter} onChange={(v) => changePack(p.code, "pcsOuter", v)} /></td>
                          <td className="num dim">{p.pcsCase}</td>
                          <td className="inp"><DecCell value={cfg.margin ?? SKU_DEFAULTS.margin} onChange={(v) => setSkuCfg(p.code, "margin", v)} /></td>
                          <td className="inp"><DecCell value={cfg.gst ?? SKU_DEFAULTS.gst} suffix="%" onChange={(v) => setSkuCfg(p.code, "gst", v)} /></td>
                        </>
                      ) : (
                        <>
                          <td className="num dim">{p.mrp}</td>
                          <td className="num">{boxesShow}</td>
                          <td className="num">{p.pcsOuter || "–"}</td>
                          <td className="num">{p.pcsCase || "–"}</td>
                          <td className="num dim">{(cfg.margin ?? SKU_DEFAULTS.margin).toFixed(2)}</td>
                          <td className="num dim">{cfg.gst ?? SKU_DEFAULTS.gst}%</td>
                        </>
                      )}
                      <td className="num">{pr.retail.toFixed(2)}</td>
                      <td className="num">{pr.rd.toFixed(2)}</td>
                      <td className="num closing">{pr.cost.toFixed(2)}</td>
                      {editing && isAdmin
                        ? <td className="inp"><DecCell value={cfg.ws ?? SKU_DEFAULTS.ws} suffix="%" onChange={(v) => setSkuCfg(p.code, "ws", v)} /></td>
                        : <td className="num dim">{cfg.ws ?? SKU_DEFAULTS.ws}%</td>}
                      <td className="num">{pr.ws.toFixed(2)}</td>
                      <td className="num dim">{(pr.cost * p.pcsCase).toFixed(2)}</td>
                      <td className={"num closing " + (pr.profitR < 0 ? "negtxt" : "oktxt")}>{pr.profitR.toFixed(2)}</td>
                      <td className={"num closing " + (pr.profitW < 0 ? "negtxt" : "oktxt")}>{pr.profitW.toFixed(2)}</td>
                      <td className="inp" style={{ whiteSpace: "nowrap" }}>
                        <button className={editing ? "unct edon" : "unct"} onClick={() => (editing ? setEditRow(null) : startEdit(p))}>
                          {editing ? "✓ Done" : "✎ Edit"}
                        </button>
                        {isAdmin && editing && (
                          <button className="unct del" style={{ marginLeft: 6 }} onClick={() => deleteProduct(p)}>🗑 Delete</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="footbar">
            <div>Showing <b>{rowsC.length}</b> / {(products || []).length} products{Object.values(cfgSel).some((v) => v != null) && <span className="dim"> · column filters active</span>}</div>
            <div className="ftot"><span>Retails = MRP ÷ Margin</span><span>RD = Retails ÷ (1 + {config.ourMargin}%)</span><span>Cost = RD ÷ (1 + GST)</span><span>WS Rate = MRP × (1 − WS%)</span></div>
          </div>
            </>);
          })()}
        </>
      )}

      {/* ===== report ===== */}
      {tab === "report" && (
        <div className="report">
          <div className="toolbar" style={{ paddingBottom: 4 }}>
            <input className="search" placeholder="Search product or code…" value={query} onChange={(e) => setQuery(e.target.value)} />
            <label className="zt">
              <input type="checkbox" checked={showZero} onChange={(e) => setShowZero(e.target.checked)} />
              show all
            </label>
          </div>
          <div className="rcards">
            <div className="rcard"><div className="rl">Opening Value (Cost ex-GST)</div><div className="rv">{inr(totals.openCost)}</div></div>
            <div className="rcard"><div className="rl">Closing Value (Cost ex-GST)</div><div className="rv">{inr(totals.closeCost)}</div></div>
            <div className="rcard"><div className="rl">Stock In (pcs)</div><div className="rv" style={{ color: "#1b7f4d" }}>{totals.mvTot.in}</div></div>
            <div className="rcard"><div className="rl">Stock Out (pcs)</div><div className="rv" style={{ color: "#b3261e" }}>{totals.mvTot.out}</div></div>
            <div className="rcard"><div className="rl">Warehouse</div><div className="rv sm">{wh}</div></div>
            <div className="rcard"><div className="rl">As on</div><div className="rv sm">{fmtDate(date)}</div></div>
          </div>
          <div className="gridwrap" style={openMrpCol ? { minHeight: 460 } : undefined}>
            {openMrpCol && <div className="hfback" onClick={() => setOpenMrpCol(null)} />}
            <table className="grid">
              <thead>
                <tr>
                  <th className="stick code">Code</th>
                  <th className="stick desc">Product</th>
                  <MrpFilterTh />
                  <th className="grp">Opening<br /><span>C · B · P</span></th>
                  <th className="num">Open<br /><span>Pcs</span></th>
                  {MOVES.map((m) => <th key={m.key} className="num" style={{ color: m.color }}>{m.label}</th>)}
                  <th className="grp closing">Closing</th>
                  <th className="num closing">Close<br /><span>Pcs</span></th>
                  <th className="num" style={{ color: "#0a6e7a" }}>Physical<br /><span>Pcs</span></th>
                  <th className="num">Diff<br /><span>Pcs</span></th>
                  <th className="num">Stock Value<br /><span>Cost ex-GST</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const od = openCBP(p.code);
                  const o = openPcs(p.code);
                  const cl = closingPcs(p.code);
                  const cd = closingCBP(p.code);
                  const mv = moves[p.code] || {};
                  const ct = counts[p.code];
                  const phys = ct ? toPcs(ct.c, ct.b, ct.p, p.pcsCase, p.pcsOuter) : null;
                  const d = ct ? phys - cl : null;
                  const cost = skuPricing(p.mrp, config.perSku[p.code] || {}, config.ourMargin).cost;
                  return (
                    <tr key={p.code} className={cl < 0 ? "rneg" : ""}>
                      <td className="stick code mono">{p.code}</td>
                      <td className="stick desc">{p.desc}</td>
                      <td className="num dim">{p.mrp}</td>
                      <td className="cbp">{od.c}·{od.b}·{od.p}</td>
                      <td className="num dim">{o}</td>
                      {MOVES.map((m) => {
                        const c = mv[m.key];
                        const t = c ? toPcs(c.c, c.b, c.p, p.pcsCase, p.pcsOuter) : 0;
                        return <td key={m.key} className="num dim">{t || ""}</td>;
                      })}
                      <td className={"cbp closing" + (cl < 0 ? " negtxt" : "")}>{cd.c}·{cd.b}·{cd.p}</td>
                      <td className={"num closing" + (cl < 0 ? " negtxt" : "")}>{cl}</td>
                      <td className="num" style={{ color: "#0a6e7a" }}>{ct ? phys : "–"}</td>
                      <td className={"num " + (d === null ? "dim" : d < 0 ? "negtxt" : d > 0 ? "exctxt" : "oktxt")}>
                        {d === null ? "" : d === 0 ? "✓" : (d > 0 ? "+" : "") + d}
                      </td>
                      <td className="num">{inr(cl * cost)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                {(() => {
                  const t = { open: 0, mv: {}, cl: 0, phys: 0, diff: 0, val: 0 };
                  MOVES.forEach((m) => (t.mv[m.key] = 0));
                  rows.forEach((p) => {
                    const o = openPcs(p.code), cl = closingPcs(p.code);
                    const cost = skuPricing(p.mrp, config.perSku[p.code] || {}, config.ourMargin).cost;
                    t.open += o; t.cl += cl; t.val += cl * cost;
                    const mv = moves[p.code] || {};
                    MOVES.forEach((m) => { const c = mv[m.key]; if (c) t.mv[m.key] += toPcs(c.c, c.b, c.p, p.pcsCase, p.pcsOuter); });
                    const ct = counts[p.code];
                    if (ct) { const ph = toPcs(ct.c, ct.b, ct.p, p.pcsCase, p.pcsOuter); t.phys += ph; t.diff += ph - cl; }
                  });
                  return (
                    <tr className="trow">
                      <td className="stick code">TOTAL</td>
                      <td className="stick desc">{rows.length} products</td>
                      <td></td>
                      <td></td>
                      <td className="num">{t.open}</td>
                      {MOVES.map((m) => <td key={m.key} className="num" style={{ color: m.color }}>{t.mv[m.key] || ""}</td>)}
                      <td></td>
                      <td className="num">{t.cl}</td>
                      <td className="num" style={{ color: "#0a6e7a" }}>{t.phys || ""}</td>
                      <td className={"num " + (t.diff < 0 ? "negtxt" : t.diff > 0 ? "exctxt" : "")}>{t.diff !== 0 ? (t.diff > 0 ? "+" : "") + t.diff : ""}</td>
                      <td className="num">{inr(t.val)}</td>
                    </tr>
                  );
                })()}
              </tfoot>
            </table>
          </div>
        </div>
      )}

      <div className="credit">An app by Jain Ankit and Co, Chartered Accountants</div>
    </div>
  );
}

const CSS = `
* { box-sizing: border-box; }
.wrap { font-family: 'IBM Plex Sans', system-ui, sans-serif; background: #f4efe6; color: #2a2018; min-height: 100vh; }
.wrap input, .wrap select, .wrap button { font-family: inherit; }
.mono { font-family: 'IBM Plex Mono', ui-monospace, monospace; }

.topbar { display:flex; justify-content:space-between; align-items:center; gap:16px; padding:14px 18px; background:#2a2018; color:#f4efe6; flex-wrap:wrap; }
.brand { display:flex; align-items:center; gap:12px; }
.logo { width:42px; height:42px; border-radius:9px; background:#6b1f24; color:#fff; display:grid; place-items:center; font-weight:800; letter-spacing:1px; font-size:14px; box-shadow:0 2px 0 #4a1419; }
.title { font-weight:800; letter-spacing:2px; font-size:18px; }
.sub { font-size:11px; opacity:.6; letter-spacing:.5px; }
.controls { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.ctl { display:flex; flex-direction:column; gap:3px; font-size:10px; text-transform:uppercase; letter-spacing:1px; opacity:.85; }
.ctl select, .ctl input { background:#3a2e22; border:1px solid #54442f; color:#f4efe6; border-radius:6px; padding:6px 8px; font-size:13px; }
.ghost { background:transparent; border:1px solid #54442f; color:#f4efe6; border-radius:6px; padding:7px 10px; cursor:pointer; font-size:12px; }
.whsel { background:#3a2e22; border:1px solid #54442f; color:#f4efe6; border-radius:6px; padding:8px 10px; font-size:13px; max-width:180px; }
.ghost.icon { padding:8px 11px; font-size:14px; line-height:1; }
.sep { width:1px; height:22px; background:#54442f; margin:0 4px; align-self:center; }
.datechip { position:relative; background:#54442f; color:#f4efe6; border-radius:6px; padding:8px 12px; font-size:12px; font-weight:700; letter-spacing:.5px; cursor:pointer; white-space:nowrap; }
.datechip:hover { background:#6b5a3f; }
.dateinput { position:absolute; inset:0; opacity:0; pointer-events:none; }
.ghost:hover { background:#3a2e22; }

.tabs { display:flex; align-items:center; gap:4px; padding:0 18px; background:#e7dccb; border-bottom:2px solid #d2c2a8; }
.tab { background:transparent; border:none; padding:11px 16px; cursor:pointer; font-weight:600; color:#6b5a45; border-bottom:3px solid transparent; font-size:13px; }
.tab.on { color:#6b1f24; border-bottom-color:#6b1f24; }
.spacer { flex:1; }
.savebox { display:flex; align-items:center; gap:10px; }
.saved { color:#1b7f4d; font-size:12px; }
.unsaved { color:#b3261e; font-size:12px; opacity:.8; }
.save { background:#6b1f24; color:#fff; border:none; padding:8px 16px; border-radius:6px; font-weight:700; cursor:pointer; }
.save:hover { background:#561a1e; }

.toolbar { display:flex; gap:12px; align-items:center; padding:12px 18px; flex-wrap:wrap; }
.search { flex:1; min-width:200px; padding:9px 12px; border:1px solid #d2c2a8; border-radius:7px; background:#fff; font-size:14px; }
.movepick { display:flex; gap:6px; flex-wrap:wrap; }
.mp { background:#fff; border:1.5px solid; border-radius:6px; padding:7px 11px; font-size:12px; font-weight:700; cursor:pointer; }
.mp.on { color:#fff !important; }
.zt { font-size:12px; display:flex; align-items:center; gap:5px; color:#6b5a45; }

.hint { padding:0 18px 10px; font-size:12px; color:#6b5a45; }

.gridwrap { overflow:auto; margin:0 14px; border:1px solid #d2c2a8; border-radius:8px; background:#fff; max-height:calc(100vh - 290px); }
.grid { border-collapse:separate; border-spacing:0; width:100%; font-size:12.5px; }
.grid thead th { position:sticky; top:0; z-index:3; background:#efe6d6; border-bottom:2px solid #d2c2a8; padding:6px 8px; text-align:center; font-size:10.5px; text-transform:uppercase; letter-spacing:.5px; color:#5b4a3a; white-space:nowrap; }
.grid thead th span { font-weight:500; opacity:.65; font-size:9.5px; }
.grid td { padding:3px 8px; border-bottom:1px solid #f0e8d8; white-space:nowrap; }
.grid tbody tr:hover td { background:#faf6ee; }
.stick { position:sticky; left:0; background:#fff; z-index:2; }
.code { left:0; min-width:78px; max-width:78px; font-size:11px; color:#6b5a45; border-right:1px solid #f0e8d8; }
.desc { left:78px; min-width:230px; max-width:230px; overflow:hidden; text-overflow:ellipsis; border-right:1px solid #e7dccb; font-weight:500; }
.grid thead th.code { z-index:4; }
.grid thead th.desc { z-index:4; }
.num { text-align:right; font-variant-numeric:tabular-nums; }
.dim { color:#9a8a72; }
.cbp { text-align:center; font-family:'IBM Plex Mono',monospace; font-size:11.5px; color:#4a3a28; }
.closing { background:#f3f7f3; font-weight:600; }
.grid thead th.closing { background:#e3eee3; color:#1b6b40; }
.inp { padding:1px 3px; text-align:center; }
.ncell { width:48px; border:1px solid #e0d4bf; border-radius:4px; padding:3px 4px; text-align:center; font-size:12.5px; background:#fffdf8; font-variant-numeric:tabular-nums; }
.ncell:focus { outline:none; border-color:#6b1f24; background:#fff; box-shadow:0 0 0 2px rgba(107,31,36,.12); }
.ncell:disabled { background:#f0ece3; color:#9a8a72; cursor:not-allowed; }
.rmkhead { text-align:left; min-width:160px; }
.rmkcell { padding:2px 6px; min-width:160px; max-width:220px; }
.rmk { width:100%; min-width:150px; border:1px solid #e0d4bf; border-radius:5px; padding:4px 6px; font:inherit; font-size:12px; background:#fffdf8; resize:none; overflow:hidden; line-height:1.35; }
.rmk:focus { outline:none; border-color:#6b1f24; background:#fff; box-shadow:0 0 0 2px rgba(107,31,36,.12); }
.rmk:disabled { background:#f0ece3; color:#5b4a3a; cursor:default; border-color:#e7dccb; }
.lockpill { color:#8a5a00; font-size:12px; font-weight:700; }
.dberr { background:#b3261e; color:#fff; padding:9px 18px; font-size:13px; font-weight:600; display:flex; align-items:center; }
.dberr .ghost2 { color:#fff; border-color:rgba(255,255,255,.5); }
.addpanel { margin:0 18px 10px; padding:12px 14px; background:#fff; border:1.5px solid #6b1f24; border-radius:9px; }
.aprow { display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end; }
.aprow label { display:flex; flex-direction:column; gap:3px; font-size:10px; text-transform:uppercase; letter-spacing:.6px; color:#6b5a45; font-weight:600; }
.aprow input { border:1px solid #d2c2a8; border-radius:6px; padding:7px 9px; font-size:13px; width:90px; background:#fffdf8; }
.aprow input:focus { outline:none; border-color:#6b1f24; box-shadow:0 0 0 2px rgba(107,31,36,.12); }
.aprow input.bad { border-color:#b3261e; background:#fdecec; }
.aprow .wide input { width:260px; }
.ghost2 { background:transparent; border:1px solid #d2c2a8; color:#6b5a45; border-radius:6px; padding:8px 14px; cursor:pointer; font-size:12px; }
.apauto { display:inline-block; padding:7px 9px; font-size:13px; font-weight:700; color:#1b6b40; background:#f0f7f0; border:1px dashed #9cc0a5; border-radius:6px; min-width:50px; text-align:center; }
.redit td { background:#fdf9ee !important; }
.unct.edon { background:#1b7f4d; border-color:#1b7f4d; color:#fff; font-weight:700; }
.unct.del { color:#b3261e; border-color:#e0a3a3; }
.unct.del:hover { background:#fdecec; }
.aperr { margin-top:8px; font-size:12px; color:#b3261e; font-weight:600; }
.apwarn { margin-top:8px; font-size:12px; color:#8a5a00; font-weight:600; }
.loginbox { background:#fff; border:1px solid #d2c2a8; border-radius:12px; padding:30px 34px; width:340px; box-shadow:0 4px 24px rgba(42,32,24,.08); }
.loginbox label { display:flex; flex-direction:column; gap:4px; font-size:10px; text-transform:uppercase; letter-spacing:.8px; color:#6b5a45; font-weight:700; margin-top:12px; }
.loginbox input { border:1px solid #d2c2a8; border-radius:7px; padding:10px 12px; font-size:14px; background:#fffdf8; }
.loginbox input:focus { outline:none; border-color:#6b1f24; box-shadow:0 0 0 2px rgba(107,31,36,.12); }
.tcell { text-align:left; }
.dwrap { display:inline-flex; align-items:center; gap:2px; }
.dcell { width:52px; }
.dsuf { font-size:10px; color:#9a8a72; }
.hfhead { position:relative; display:inline-block; }
.hfbtn { background:transparent; border:none; cursor:pointer; font-size:8px; color:#9a8a72; padding:1px 3px; margin-left:3px; vertical-align:middle; }
.hfbtn.on { color:#fff; background:#6b1f24; border-radius:3px; }
.grid thead th.fopen { z-index:8 !important; }
.hfpop { position:absolute; top:100%; right:-10px; z-index:60; background:#fff; border:1px solid #d2c2a8; border-radius:8px; box-shadow:0 6px 20px rgba(42,32,24,.18); width:180px; padding:8px; text-align:left; text-transform:none; letter-spacing:0; font-weight:400; }
.hfsearch { width:100%; border:1px solid #d2c2a8; border-radius:5px; padding:5px 7px; font-size:12px; margin-bottom:6px; }
.hfactions { display:flex; gap:6px; margin-bottom:6px; }
.hfactions button { flex:1; background:#f4efe6; border:1px solid #d2c2a8; border-radius:5px; padding:4px; font-size:11px; cursor:pointer; }
.hfactions button:hover { background:#e7dccb; }
.hflist { max-height:220px; overflow-y:scroll; }
.hflist::-webkit-scrollbar { width:8px; }
.hflist::-webkit-scrollbar-thumb { background:#d2c2a8; border-radius:4px; }
.hflist::-webkit-scrollbar-track { background:#f4efe6; border-radius:4px; }
.hfitem { display:flex; align-items:center; gap:6px; font-size:12px; padding:3px 2px; color:#2a2018; cursor:pointer; }
.hfitem:hover { background:#faf6ee; }
.hfempty { font-size:11px; color:#9a8a72; padding:4px; }
.hfback { position:fixed; inset:0; z-index:7; }
.trow td { position:sticky; bottom:0; background:#efe6d6 !important; font-weight:700; border-top:2px solid #d2c2a8; z-index:2; }
.trow td.stick { z-index:3; }
.rneg td { background:#fdecec !important; }
.negtxt { color:#b3261e !important; }
.rexc td { background:#fdf6e3 !important; }
.rok td { background:#f0f7f0 !important; }
.exctxt { color:#8a5a00 !important; font-weight:600; }
.oktxt { color:#1b7f4d !important; font-weight:600; }
.rsub { font-size:11px; font-weight:500; color:#9a8a72; }
.unct { background:transparent; border:1px solid #d2c2a8; border-radius:4px; color:#6b5a45; cursor:pointer; font-size:12px; padding:2px 7px; }
.unct:hover { background:#f4efe6; }

.footbar { display:flex; justify-content:space-between; align-items:center; gap:18px; padding:11px 22px; font-size:12px; color:#5b4a3a; flex-wrap:wrap; }
.ftot { display:flex; gap:14px; flex-wrap:wrap; }

.report { padding:8px 4px; }
.panelgrid { display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:12px; padding:4px 18px 18px; }
.panel { background:#fff; border:1px solid #d2c2a8; border-radius:10px; padding:13px 16px; }
.ptitle { font-size:10.5px; text-transform:uppercase; letter-spacing:1px; color:#9a8a72; margin-bottom:9px; }
.prow { display:flex; justify-content:space-between; gap:10px; font-size:12.5px; padding:5px 0; border-bottom:1px dashed #f0e8d8; }
.prow:last-child { border-bottom:none; }
.prow span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.rcards { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; padding:10px 18px 16px; }
.rcard { background:#fff; border:1px solid #d2c2a8; border-radius:10px; padding:13px 15px; }
.rl { font-size:10.5px; text-transform:uppercase; letter-spacing:1px; color:#9a8a72; margin-bottom:5px; }
.rv { font-size:22px; font-weight:800; color:#2a2018; }
.rv.sm { font-size:14px; font-weight:700; }

.credit { text-align:center; font-size:11px; color:#9a8a72; padding:14px 18px 18px; letter-spacing:.4px; }

@media (max-width:640px){
  .desc { min-width:150px; max-width:150px; }
  .desc { left:78px; }
  .gridwrap { max-height:calc(100vh - 340px); }
}
`;
