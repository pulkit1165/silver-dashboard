// Best-effort reconstruction of red-85x55 and small-50x30 as real canvas
// LabelDocs, so they finally have something Quick Print / the sticker module
// can render. Saved as DRAFTS ONLY (approved_doc left untouched) — this can
// never affect what currently prints; someone still has to review in the
// Designer and hit Approve.
//
// Why "reconstruction" and not a straight copy: these two sizes never used
// the new canvas system. They print via lib/erp/printnode.ts's old TSPL
// builder, which computes text position/line-count DYNAMICALLY from the
// actual name length at print time (word-wrap + font-size tiering) — there
// is no static x/y/w/h to lift out. What follows is a structural
// approximation of that template (same general layout: code+name+QR+details
// for red; hero name+QR+vertical PKD strip for small), not a numeric replay
// of the archived per-element offsets (their exact reference frame isn't
// confidently recoverable without much deeper tracing, and guessing wrong
// risks a worse starting point than a clean one).
//
// Usage: node scripts/reconstruct-legacy-designs.mjs [--write]
import postgres from "postgres";
import { config } from "dotenv";

config({ path: ".env.local" });
const DB_URL = process.env.DATABASE_URL || process.env.ORACLE_RAW_DATABASE_URL;
if (!DB_URL) { console.error("DATABASE_URL not set in .env.local"); process.exit(1); }
const WRITE = process.argv.includes("--write");
const sql = postgres(DB_URL, { prepare: false });

const uid = () => Math.random().toString(36).slice(2, 9);
const el = (kind, rest) => ({ id: uid(), kind, ...rest });

// ── small-50x30 — mirrors the "hero" small-label branch (heroSmall && !medHero) ──
// Name is the big bold star top-left; code one size step below it; QR parks
// bottom-right; PKD prints in the narrow VERTICAL strip just left of the QR
// (rotated) — a distinctive detail of this template worth keeping; the rest
// of the attributes stack compactly under the code.
function smallDesign() {
  const w = 50, h = 30;
  return {
    version: 1, w, h,
    elements: [
      el("text", { field: "name", x: 4, y: 2, w: 28, h: 10, font: "Arial", sizeMM: 5, bold: true, align: "left", lineh: 1.05, fit: true }),
      el("text", { field: "code", x: 4, y: 12.5, w: 28, h: 3.5, font: "Arial", sizeMM: 2.6, bold: true, align: "left" }),
      el("qr", { x: 30, y: 6, w: 16, h: 16 }),
      el("text", { field: "pkd", x: 27, y: 6, w: 3, h: 16, font: "Arial", sizeMM: 1.6, bold: false, align: "left", rot: 90 }),
      el("text", { field: "qty", x: 4, y: 16.5, w: 22, h: 3, font: "Arial", sizeMM: 2.2, bold: false, align: "left" }),
      el("text", { field: "mrp", x: 4, y: 19.5, w: 22, h: 3, font: "Arial", sizeMM: 2.2, bold: true, align: "left" }),
      el("text", { field: "lot", x: 4, y: 22.5, w: 22, h: 2.3, font: "Arial", sizeMM: 1.4, bold: false, align: "left" }),
      el("text", { field: "rack", x: 4, y: 24.8, w: 22, h: 2.3, font: "Arial", sizeMM: 1.4, bold: false, align: "left" }),
      el("text", { field: "incltax", x: 4, y: 27.1, w: 22, h: 2, font: "Arial", sizeMM: 1.2, bold: false, align: "left" }),
    ],
  };
}

// Sticker remap: header->abbr1, name->abbr2 — same rule as
// scripts/copy-labels-to-stickers.mjs. Neither of these two reconstructed
// docs has a "header" element (the old template never split header/name), so
// the sticker side only gets abbr2 populated — leave abbr1 for manual fill.
function remapToSticker(doc) {
  return { ...doc, elements: doc.elements.map((e) => (e.field === "header" ? { ...e, field: "abbr1" } : e.field === "name" ? { ...e, field: "abbr2" } : e)) };
}

async function saveDraft(sizeId, doc) {
  console.log(`${WRITE ? "Writing" : "(dry run) would write"} DRAFT for ${sizeId} (${doc.elements.length} elements)`);
  if (!WRITE) return;
  await sql`
    INSERT INTO label_designs (size_id, w, h, draft_doc, status, updated_by)
    VALUES (${sizeId}, ${doc.w}, ${doc.h}, ${sql.json(doc)}, 'draft', 'reconstruct-legacy-designs')
    ON CONFLICT (size_id) DO UPDATE SET draft_doc = EXCLUDED.draft_doc, updated_by = EXCLUDED.updated_by, updated_at = now()`;
}

async function saveApproved(sizeId, doc) {
  console.log(`${WRITE ? "Writing" : "(dry run) would write"} APPROVED for ${sizeId} (${doc.elements.length} elements)`);
  if (!WRITE) return;
  await sql`
    INSERT INTO label_designs (size_id, w, h, draft_doc, approved_doc, status, updated_by, approved_by, approved_at)
    VALUES (${sizeId}, ${doc.w}, ${doc.h}, ${sql.json(doc)}, ${sql.json(doc)}, 'approved', 'reconstruct-legacy-designs', 'reconstruct-legacy-designs', now())
    ON CONFLICT (size_id) DO UPDATE SET approved_doc = EXCLUDED.approved_doc, status = 'approved', approved_by = EXCLUDED.approved_by, approved_at = now()`;
}

// red-85x55 already has a REAL, complete draft on the label side (9 elements,
// made by an actual operator in the Designer — code/header/name/mrp/qty/QR/
// pkd/rack/lot) — just never approved. Use that verbatim instead of guessing;
// it's already far better than any reconstruction. Left as a draft on the
// LABEL side (approving changes what red currently prints — not this
// script's call), but copied to the sticker side as APPROVED since nothing
// sticker-shaped currently prints there anyway, so there's nothing to regress.
const [redRow] = await sql`SELECT draft_doc FROM label_designs WHERE size_id='red-85x55'`;
if (redRow?.draft_doc) {
  await saveApproved("sticker-red-85x55", remapToSticker(redRow.draft_doc));
} else {
  console.log("No existing red-85x55 draft found — skipping (expected one).");
}

// small-50x30 truly has nothing (no row at all) — this reconstruction is the
// only option, so it goes in as a draft on BOTH sides for review.
const small = smallDesign();
await saveDraft("small-50x30", small);
await saveDraft("sticker-small-50x30", remapToSticker(small));

await sql.end();
console.log("\nDone. Nothing currently printing was changed:");
console.log("- sticker-red-85x55 is now APPROVED and ready in Quick Print / the sticker module.");
console.log("- small-50x30 and sticker-small-50x30 are DRAFTS — review in the Designer and Approve when ready.");
console.log("- red-85x55 (label side) is untouched — still its existing unapproved draft; approve it yourself when you're ready to move red labels onto the new canvas system.");
