"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ChecklistStage } from "@/lib/erp/checklist";

/**
 * The live, shared process checklist. Reads its initial data from the server
 * page; every tick/edit is optimistic + persisted via /api/erp/checklist, and
 * the whole-ERP <LiveSync> poller re-renders the page when anyone (any device,
 * the client included) changes something — we then reconcile local state with
 * the fresh server props (unless the user is mid-edit).
 */

const TINT: Record<string, string> = {
  blue: "#2E6AA6", amber: "#B5811E", teal: "#1F7A80",
  red: "#cc1f2d", violet: "#6D4AA6", green: "#0e7a43",
};
const tc = (t: string) => TINT[t] ?? TINT.blue;

function sig(stages: ChecklistStage[]): string {
  return stages.map((s) => `${s.id}:${s.title}:${s.owner}:${s.description}:` +
    s.tasks.map((t) => `${t.id},${t.done ? 1 : 0},${t.label}`).join("|")).join("¦");
}

export default function ProcessChecklist({
  initial, me, canReset,
}: { initial: ChecklistStage[]; me: string; canReset: boolean }) {
  const router = useRouter();
  const [stages, setStages] = useState(initial);
  const [open, setOpen] = useState<Set<number>>(() => new Set(initial[0] ? [initial[0].id] : []));
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [toastMsg, setToastMsg] = useState("");
  const editingRef = useRef(false);
  const lastSig = useRef(sig(initial));
  const toastT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Reconcile with fresh server props after a LiveSync refresh — but never yank
  // the ground out from under someone who's actively typing in a field.
  useEffect(() => {
    const incoming = sig(initial);
    if (incoming !== lastSig.current && !editingRef.current) {
      setStages(initial);
      lastSig.current = incoming;
    }
  }, [initial]);

  function toast(m: string) {
    setToastMsg(m);
    clearTimeout(toastT.current);
    toastT.current = setTimeout(() => setToastMsg(""), 2200);
  }

  async function call(path: string, method: string, body?: unknown) {
    const r = await fetch(`/api/erp/checklist${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const d = await r.json().catch(() => ({ ok: false, error: "Network error" }));
    if (!d.ok) throw new Error(d.error || "Could not save");
    return d;
  }

  // ---- task ops (optimistic) ----
  function toggle(stageId: number, taskId: number, done: boolean) {
    setStages((prev) => prev.map((s) => s.id !== stageId ? s
      : { ...s, tasks: s.tasks.map((t) => t.id !== taskId ? t : { ...t, done, doneBy: done ? me : null }) }));
    call(`/task/${taskId}`, "PATCH", { done }).then(() => router.refresh())
      .catch((e) => { toast(e.message); router.refresh(); });
  }
  function commitLabel(taskId: number, el: HTMLElement, prev: string) {
    editingRef.current = false;
    const v = (el.textContent || "").trim();
    if (!v) { el.textContent = prev; return; }
    if (v === prev) return;
    call(`/task/${taskId}`, "PATCH", { label: v }).then(() => router.refresh())
      .catch((e) => { toast(e.message); el.textContent = prev; });
  }
  function removeTask(stageId: number, taskId: number) {
    setStages((prev) => prev.map((s) => s.id !== stageId ? s : { ...s, tasks: s.tasks.filter((t) => t.id !== taskId) }));
    call(`/task/${taskId}`, "DELETE").then(() => router.refresh()).catch((e) => { toast(e.message); router.refresh(); });
  }
  function addTask(stageId: number) {
    const label = (drafts[stageId] || "").trim();
    if (!label) return;
    setDrafts((d) => ({ ...d, [stageId]: "" }));
    call("/task", "POST", { stageId, label }).then(() => router.refresh()).catch((e) => toast(e.message));
  }

  // ---- stage ops ----
  function commitStage(stageId: number, field: "title" | "owner", el: HTMLElement, prev: string) {
    editingRef.current = false;
    const v = (el.textContent || "").trim();
    if (!v || v === prev) { if (!v) el.textContent = prev; return; }
    call(`/stage/${stageId}`, "PATCH", { [field]: v }).then(() => router.refresh())
      .catch((e) => { toast(e.message); el.textContent = prev; });
  }
  function addStage() {
    const title = window.prompt("Name of the new stage:");
    if (!title || !title.trim()) return;
    call("/stage", "POST", { title: title.trim() }).then(() => router.refresh()).catch((e) => toast(e.message));
  }
  function removeStage(stageId: number, title: string) {
    if (!window.confirm(`Delete the whole stage “${title}” and all its tasks?`)) return;
    call(`/stage/${stageId}`, "DELETE").then(() => router.refresh()).catch((e) => toast(e.message));
  }
  function reset() {
    if (!window.confirm("Reset every stage and task back to the starting template? This clears all ticks and edits for everyone.")) return;
    call("/reset", "POST").then(() => router.refresh()).catch((e) => toast(e.message));
  }

  function toggleOpen(id: number) {
    setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function jumpTo(id: number) {
    setOpen((s) => new Set(s).add(id));
    document.getElementById(`stage-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function printAll() { setOpen(new Set(stages.map((s) => s.id))); setTimeout(() => window.print(), 60); }

  const ghost = "rounded-lg border border-[var(--border-2)] bg-[var(--surface)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--ink-2)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]";

  const overall = useMemo(() => {
    const all = stages.flatMap((s) => s.tasks);
    const done = all.filter((t) => t.done).length;
    return { done, total: all.length, pct: all.length ? Math.round((done / all.length) * 100) : 0 };
  }, [stages]);

  return (
    <div>
      {/* toolbar */}
      <div className="mb-5 flex flex-wrap items-center gap-3 print:hidden">
        <div className="flex items-center gap-2.5">
          <div className="h-2 w-40 overflow-hidden rounded-full border border-[var(--border)] bg-[var(--surface-2)]">
            <div className="h-full rounded-full bg-[var(--accent)] transition-all" style={{ width: `${overall.pct}%` }} />
          </div>
          <span className="text-sm font-bold tabular-nums">{overall.pct}%</span>
          <span className="text-xs font-medium text-[var(--muted)] tabular-nums">{overall.done}/{overall.total} done</span>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <button onClick={() => setOpen(new Set(stages.map((s) => s.id)))} className={ghost}>⊕ Expand all</button>
          <button onClick={() => setOpen(new Set())} className={ghost}>⊖ Collapse all</button>
          <button onClick={printAll} className={ghost}>⎙ Print / PDF</button>
          {canReset && <button onClick={reset} className={ghost}>↺ Reset</button>}
        </div>
      </div>

      {/* cycle strip */}
      <div className="mb-6 print:hidden">
        <div className="mb-2.5 flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-widest text-[var(--muted)]">
          The loop <span className="font-sans font-semibold normal-case tracking-normal text-[var(--muted-2)]">↻ closed — ends back at MRN</span>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-2">
          {stages.map((s, i) => {
            const done = s.tasks.filter((t) => t.done).length, pct = s.tasks.length ? Math.round(done / s.tasks.length * 100) : 0;
            const col = tc(s.tint);
            return (
              <button key={s.id} onClick={() => jumpTo(s.id)}
                className="relative w-[150px] flex-none rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-left transition hover:-translate-y-0.5 hover:border-[var(--border-2)]"
                style={pct === 100 ? { boxShadow: `inset 0 0 0 1.5px ${col}` } : undefined}>
                <span className="grid h-[22px] w-[22px] place-items-center rounded-md font-mono text-[11px] font-bold text-white" style={{ background: col }}>{i + 1}</span>
                <div className="mt-2 text-[13px] font-bold leading-tight tracking-tight">{s.title}</div>
                <div className="mt-1.5 flex justify-between font-mono text-[10px] text-[var(--muted)]"><span>{done}/{s.tasks.length}</span><span>{pct}%</span></div>
                <div className="mt-2 h-[5px] overflow-hidden rounded-full bg-[var(--surface-2)]"><span className="block h-full rounded-full" style={{ width: `${pct}%`, background: col }} /></div>
                <span className="absolute -right-3 top-1/2 -translate-y-1/2 text-[15px]" style={{ color: i < stages.length - 1 ? "var(--border-2)" : "var(--accent)" }}>{i < stages.length - 1 ? "→" : "↺"}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* stages */}
      <div className="flex flex-col gap-4">
        {stages.map((s, idx) => {
          const done = s.tasks.filter((t) => t.done).length, total = s.tasks.length;
          const pct = total ? Math.round(done / total * 100) : 0;
          const status = total === 0 || done === 0 ? "todo" : done === total ? "done" : "doing";
          const col = tc(s.tint);
          const isOpen = open.has(s.id);
          return (
            <section key={s.id} id={`stage-${s.id}`} className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] print:break-inside-avoid"
              style={{ borderLeft: `4px solid ${col}` }}>
              {/* header */}
              <div className="flex cursor-pointer items-center gap-3.5 px-4 py-3.5" onClick={() => toggleOpen(s.id)}>
                <div className="grid h-[34px] w-[34px] flex-none place-items-center rounded-lg font-mono text-[15px] font-bold text-white" style={{ background: col }}>{idx + 1}</div>
                <div className="min-w-0 flex-1">
                  <p className="m-0 flex flex-wrap items-center gap-2 text-[16px] font-extrabold tracking-tight">
                    <span contentEditable suppressContentEditableWarning spellCheck={false}
                      onClick={(e) => e.stopPropagation()}
                      onFocus={() => { editingRef.current = true; }}
                      onBlur={(e) => commitStage(s.id, "title", e.currentTarget, s.title)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
                      className="rounded outline-none focus:shadow-[inset_0_0_0_1.5px_var(--accent)]">{s.title}</span>
                  </p>
                  <div className="mt-1 font-mono text-[11px] text-[var(--muted)]">Owner:{" "}
                    <b contentEditable suppressContentEditableWarning spellCheck={false}
                      onClick={(e) => e.stopPropagation()}
                      onFocus={() => { editingRef.current = true; }}
                      onBlur={(e) => commitStage(s.id, "owner", e.currentTarget, s.owner)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
                      className="border-b border-dashed border-[var(--border-2)] px-0.5 font-bold text-[var(--ink-2)] outline-none focus:border-[var(--accent)] focus:text-[var(--accent)]">{s.owner || "Unassigned"}</b>
                  </div>
                </div>
                <div className="flex flex-none items-center gap-3">
                  <span className={`rounded-full px-2.5 py-1 font-mono text-[10.5px] font-bold tracking-wide ${status === "done" ? "bg-[var(--accent-2-bg)] text-[var(--accent-2)]" : status === "doing" ? "bg-[var(--warning-bg)] text-[var(--warning)]" : "bg-[var(--surface-2)] text-[var(--muted)]"}`}>
                    {status === "done" ? "COMPLETE" : status === "doing" ? "IN PROGRESS" : "NOT STARTED"}
                  </span>
                  <span className="min-w-[46px] text-right font-mono text-[13px] font-bold tabular-nums text-[var(--ink-2)]">{done}/{total}</span>
                  <span className="flex-none text-[var(--muted)] transition-transform" style={{ transform: isOpen ? "rotate(90deg)" : "none" }}>▶</span>
                </div>
              </div>
              <div className="h-1 bg-[var(--surface-2)]"><span className="block h-full transition-all" style={{ width: `${pct}%`, background: col }} /></div>

              {/* body */}
              {isOpen && (
                <div className="px-4 pb-4 pt-1.5">
                  {s.description && <p className="my-2.5 max-w-[80ch] text-[13px] text-[var(--muted)]">{s.description}</p>}
                  <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                    {s.tasks.map((t, i) => (
                      <li key={t.id} className={`group flex items-start gap-3 rounded-lg px-2 py-2 transition hover:bg-[var(--surface-2)] ${t.done ? "is-done" : ""}`}>
                        <input type="checkbox" checked={t.done} onChange={(e) => toggle(s.id, t.id, e.target.checked)}
                          className="mt-0.5 h-[19px] w-[19px] flex-none cursor-pointer accent-[var(--accent-2)]" aria-label="Done" />
                        <span className="w-5 flex-none pt-0.5 text-right font-mono text-[11px] text-[var(--border-2)] tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                        <span contentEditable suppressContentEditableWarning spellCheck={false}
                          onFocus={() => { editingRef.current = true; }}
                          onBlur={(e) => commitLabel(t.id, e.currentTarget, t.label)}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
                          className={`min-w-0 flex-1 rounded px-1 text-[14px] outline-none focus:shadow-[inset_0_0_0_1.5px_var(--accent)] ${t.done ? "text-[var(--muted)] line-through decoration-[var(--border-2)]" : ""}`}>{t.label}</span>
                        {t.done && t.doneBy && <span className="hidden flex-none pt-0.5 font-mono text-[10px] text-[var(--muted-2)] sm:inline">✓ {t.doneBy}</span>}
                        <button onClick={() => removeTask(s.id, t.id)} title="Delete task"
                          className="flex-none px-1 text-[15px] leading-tight text-[var(--border-2)] opacity-0 transition hover:text-[var(--accent)] group-hover:opacity-100 print:hidden" aria-label="Delete task">✕</button>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 flex gap-2 pl-2 print:hidden">
                    <input value={drafts[s.id] || ""} onChange={(e) => setDrafts((d) => ({ ...d, [s.id]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === "Enter") addTask(s.id); }}
                      placeholder="Add a sub-task to this stage…"
                      className="flex-1 rounded-lg border border-dashed border-[var(--border-2)] bg-[var(--background)] px-3 py-2 text-[13.5px] outline-none focus:border-solid focus:border-[var(--accent)] focus:bg-[var(--surface)]" />
                    <button onClick={() => addTask(s.id)} className="rounded-lg border border-[var(--border-2)] bg-[var(--surface)] px-3.5 text-[13px] font-bold text-[var(--ink-2)] hover:border-[var(--accent)] hover:text-[var(--accent)]">Add</button>
                    <button onClick={() => removeStage(s.id, s.title)} className="rounded-lg border border-[var(--border-2)] bg-[var(--surface)] px-3 text-[13px] text-[var(--muted)] hover:border-[var(--danger)] hover:text-[var(--danger)]" title="Delete stage">Delete stage</button>
                  </div>
                </div>
              )}
            </section>
          );
        })}
      </div>

      <button onClick={addStage} className="mt-4 w-full rounded-xl border-[1.5px] border-dashed border-[var(--border-2)] py-3.5 text-[13.5px] font-bold text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] print:hidden">＋ Add a stage</button>

      <p className="mt-4 text-center text-xs text-[var(--muted)] print:hidden">Live &amp; shared — every tick and edit saves for everyone and syncs across devices within seconds.</p>

      {toastMsg && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-[var(--foreground)] px-4 py-2.5 text-[13px] font-semibold text-white shadow-lg">{toastMsg}</div>
      )}
    </div>
  );
}
