// ---- Supabase shared storage ----
// All app data lives in one `kv` table (key text PK, value jsonb).
// The anon key below is Supabase's public client key — safe to ship in the bundle.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://jrnofxyxpvgzdtmdohjq.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impybm9meHl4cHZnemR0bWRvaGpxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4MjE4MDIsImV4cCI6MjA5NjM5NzgwMn0.ms3PDpHFhCNCI69TeE5Y_7uZMVfagUKV54OcyPfzpv8";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// optional error hook so the app can show a banner
let errHandler = null;
export const onStorageError = (fn) => { errHandler = fn; };
const report = (e) => { console.error("storage:", e); if (errHandler) errHandler(e.message || String(e)); };

// fetch many keys in one round trip → { key: value }
export async function kvGetMany(keys) {
  const { data, error } = await supabase.from("kv").select("key,value").in("key", keys);
  if (error) throw error;
  const m = {};
  (data || []).forEach((r) => (m[r.key] = r.value));
  return m;
}

export async function kvGet(key) {
  const m = await kvGetMany([key]);
  return m[key] ?? null;
}

// write-through; await it when the UI must know it landed
export async function kvSet(key, value) {
  const { error } = await supabase
    .from("kv")
    .upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw error;
}

// fire-and-forget variant for low-stakes writes (config, counts)
export function kvSetBg(key, value) {
  kvSet(key, value).catch(report);
}

// fetch keys matching a SQL LIKE pattern (e.g. "cad:mv:Main Warehouse:%")
export async function kvGetLike(pattern) {
  const { data, error } = await supabase.from("kv").select("key,value").like("key", pattern);
  if (error) throw error;
  return data || [];
}

export async function kvUpsertMany(rows) {
  const { error } = await supabase.from("kv").upsert(rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })));
  if (error) throw error;
}

export async function kvDeleteMany(keys) {
  if (!keys.length) return;
  const { error } = await supabase.from("kv").delete().in("key", keys);
  if (error) throw error;
}

