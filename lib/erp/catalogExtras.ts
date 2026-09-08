import "server-only";
import { getSql } from "./db";

// Editable extras for the Product Catalogue that live in the DB (Vercel's filesystem
// is read-only at runtime, so uploaded images are stored as data-URLs here):
//   k = 'top_note'          -> special text shown at the top of the catalogue
//   k = 'logo'              -> masthead logo image (data URL); absent = no logo
//   k = 'photo:<HEADER>'    -> a category's photo (data URL), overrides the static one
export interface CatalogExtras {
  topNote: string;
  logo: string | null;
  photos: Record<string, string>; // header -> data URL
}

let ensured: Promise<void> | null = null;
function ensure(): Promise<void> {
  if (!ensured) {
    const sql = getSql();
    ensured = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS catalog_kv (
        k text PRIMARY KEY,
        v text NOT NULL DEFAULT '',
        updated_by text,
        updated_at text DEFAULT to_char(now(),'YYYY-MM-DD HH24:MI:SS')
      )`;
    })().catch((e) => { ensured = null; throw e; });
  }
  return ensured;
}

const PHOTO = "photo:";

export async function getCatalogExtras(): Promise<CatalogExtras> {
  try {
    await ensure();
    const rows = (await getSql()`SELECT k, v FROM catalog_kv`) as unknown as { k: string; v: string }[];
    const out: CatalogExtras = { topNote: "", logo: null, photos: {} };
    for (const r of rows) {
      if (r.k === "top_note") out.topNote = r.v || "";
      else if (r.k === "logo") out.logo = r.v || null;
      else if (r.k.startsWith(PHOTO)) { if (r.v) out.photos[r.k.slice(PHOTO.length)] = r.v; }
    }
    return out;
  } catch { return { topNote: "", logo: null, photos: {} }; }
}

async function setKv(k: string, v: string, actor?: string | null): Promise<void> {
  await ensure();
  const sql = getSql();
  if (!v) { await sql`DELETE FROM catalog_kv WHERE k=${k}`; return; }
  await sql`INSERT INTO catalog_kv (k, v, updated_by, updated_at)
    VALUES (${k}, ${v}, ${actor ?? null}, to_char(now(),'YYYY-MM-DD HH24:MI:SS'))
    ON CONFLICT (k) DO UPDATE SET v=${v}, updated_by=${actor ?? null}, updated_at=to_char(now(),'YYYY-MM-DD HH24:MI:SS')`;
}

export const setCatalogNote  = (text: string, actor?: string | null) => setKv("top_note", String(text ?? "").slice(0, 2000), actor);
export const setCatalogLogo  = (dataUrl: string, actor?: string | null) => setKv("logo", String(dataUrl ?? ""), actor);
export const setCatalogPhoto = (header: string, dataUrl: string, actor?: string | null) =>
  setKv(PHOTO + String(header ?? "").trim(), String(dataUrl ?? ""), actor);
