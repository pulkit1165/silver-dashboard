import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { lockLabelSize, unlockLabelSize, listLabelLocks, restoreLabelLock } from "@/lib/erp/labelLayout";
import { logActivity } from "@/lib/erp/activity";

export const dynamic = "force-dynamic";

// GET → the list of locked-label snapshots (unique code, size, who/when) so a
// disturbed layout can always be found and restored by its code.
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, locks: await listLabelLocks() });
}

// POST { action, sizeId?, w?, h?, lockCode? }
//  - lock:    freeze this size, mint a unique code, snapshot the full layout
//  - unlock:  allow edits again (kept in history)
//  - restore: re-apply a saved snapshot by its code and re-freeze
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "labels")) return NextResponse.json({ ok: false, error: `Role ${user.role} cannot lock labels.` }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const action = String(b.action || "").trim();

  if (action === "lock") {
    const sizeId = String(b.sizeId || "").trim();
    if (!sizeId) return NextResponse.json({ ok: false, error: "sizeId required" }, { status: 400 });
    const { lockCode, already } = await lockLabelSize(sizeId, { w: Number(b.w) || undefined, h: Number(b.h) || undefined }, user.name);
    await logActivity({
      actor: user.name, actorRole: user.role, action: "label.lock", entity: "label_layout", entityId: sizeId,
      summary: `${already ? "Already locked" : "Locked"} ${sizeId} as ${lockCode} (design + alignment frozen)`,
      meta: { sizeId, lockCode },
    }).catch(() => {});
    return NextResponse.json({ ok: true, lockCode, already: !!already });
  }

  if (action === "unlock") {
    const sizeId = String(b.sizeId || "").trim();
    if (!sizeId) return NextResponse.json({ ok: false, error: "sizeId required" }, { status: 400 });
    await unlockLabelSize(sizeId, user.name);
    await logActivity({ actor: user.name, actorRole: user.role, action: "label.unlock", entity: "label_layout", entityId: sizeId, summary: `Unlocked ${sizeId} (editing re-enabled)`, meta: { sizeId } }).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  if (action === "restore") {
    const lockCode = String(b.lockCode || "").trim();
    if (!lockCode) return NextResponse.json({ ok: false, error: "lockCode required" }, { status: 400 });
    const res = await restoreLabelLock(lockCode, user.name);
    if (!res) return NextResponse.json({ ok: false, error: `No saved lock ${lockCode}` }, { status: 404 });
    await logActivity({ actor: user.name, actorRole: user.role, action: "label.lock.restore", entity: "label_layout", entityId: res.sizeId, summary: `Restored ${res.sizeId} from ${lockCode} (re-frozen)`, meta: { sizeId: res.sizeId, lockCode } }).catch(() => {});
    return NextResponse.json({ ok: true, sizeId: res.sizeId });
  }

  return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
}
