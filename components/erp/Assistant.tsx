"use client";

import { useEffect, useRef, useState } from "react";

type Step = { sql: string; status: "running" | "done" | "error"; rowCount?: number; truncated?: boolean; sample?: Record<string, unknown>[]; error?: string };
type Msg = { role: "user" | "assistant"; text: string; steps: Step[]; error?: string };

const SUGGESTIONS = [
  "Which customer reorders the most?",
  "Sales by customer — who's highest and lowest?",
  "Top 10 best-selling SKUs by quantity",
  "Which items are slow-moving or dead stock?",
  "Transport summary per customer (transporter, trips, distance)",
  "Open sales orders still pending dispatch",
];

export default function Assistant({ configured }: { configured: boolean }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }); }, [messages]);

  // mutate the last (streaming) assistant message
  const patchLast = (fn: (m: Msg) => void) =>
    setMessages((ms) => { const copy = ms.slice(); const m = { ...copy[copy.length - 1] }; m.steps = m.steps.slice(); fn(m); copy[copy.length - 1] = m; return copy; });

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setInput("");
    const priorApi = messages.map((m) => ({ role: m.role, content: m.text }));
    setMessages((ms) => [...ms, { role: "user", text: q, steps: [] }, { role: "assistant", text: "", steps: [] }]);
    setBusy(true);
    try {
      const res = await fetch("/api/erp/assistant", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: [...priorApi, { role: "user", content: q }] }),
      });
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}));
        patchLast((m) => { m.error = d.error || `Request failed (${res.status})`; });
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
          if (!line) continue;
          let ev: Record<string, unknown>;
          try { ev = JSON.parse(line); } catch { continue; }
          if (ev.type === "text") patchLast((m) => { m.text += String(ev.delta); });
          else if (ev.type === "sql") patchLast((m) => { m.steps.push({ sql: String(ev.sql), status: "running" }); });
          else if (ev.type === "rows") patchLast((m) => { const s = m.steps[m.steps.length - 1]; if (s) { s.status = "done"; s.rowCount = ev.rowCount as number; s.truncated = ev.truncated as boolean; s.sample = ev.sample as Record<string, unknown>[]; } });
          else if (ev.type === "sql_error") patchLast((m) => { const s = m.steps[m.steps.length - 1]; if (s) { s.status = "error"; s.error = String(ev.error); } });
          else if (ev.type === "error") patchLast((m) => { m.error = String(ev.error); });
        }
      }
    } catch (e) {
      patchLast((m) => { m.error = String((e as Error)?.message || e); });
    } finally {
      setBusy(false);
    }
  }

  if (!configured) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <div className="text-lg font-bold">AI assistant not configured yet</div>
        <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
          The assistant uses Claude to read the ERP and answer questions. To turn it on, add an{" "}
          <code className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-xs">ANTHROPIC_API_KEY</code>{" "}
          environment variable (in Vercel for production, and <code className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-xs">.env.local</code> for local dev), then redeploy.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-12rem)] min-h-[480px] flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <div ref={scroller} className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="mx-auto max-w-2xl pt-6 text-center">
            <div className="text-2xl">✦</div>
            <div className="mt-2 text-lg font-bold">Ask anything about your business</div>
            <p className="mt-1 text-sm text-[var(--muted)]">I read the live ERP and answer with real numbers. I can only read data — I never change anything.</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => ask(s)} className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5 text-xs font-semibold hover:bg-[var(--accent-bg)] hover:text-[var(--accent-strong)]">{s}</button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${m.role === "user" ? "bg-[var(--accent)] text-white" : "border border-[var(--border)] bg-[var(--surface-2)]"}`}>
              {m.steps.length > 0 && (
                <details className="mb-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] open:pb-2">
                  <summary className="cursor-pointer px-2.5 py-1.5 text-xs font-bold text-[var(--muted)]">
                    {m.steps.length} {m.steps.length === 1 ? "query" : "queries"} run {m.steps.some((s) => s.status === "running") ? "· running…" : ""}
                  </summary>
                  <div className="space-y-2 px-2.5">
                    {m.steps.map((s, j) => (
                      <div key={j}>
                        <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-[var(--surface-2)] p-2 font-mono text-[11px] leading-snug">{s.sql}</pre>
                        {s.status === "error" && <div className="mt-1 text-[11px] font-semibold text-[var(--danger)]">⚠ {s.error}</div>}
                        {s.status === "done" && (
                          <div className="mt-1 text-[11px] text-[var(--muted)]">
                            {s.rowCount} row{s.rowCount === 1 ? "" : "s"}{s.truncated ? " (showing first 500)" : ""}
                            {s.sample && s.sample.length > 0 && <ResultTable rows={s.sample} />}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              )}
              <div className="whitespace-pre-wrap leading-relaxed">{m.text || (m.role === "assistant" && !m.error && busy && i === messages.length - 1 ? "…" : "")}</div>
              {m.error && <div className="mt-1 text-xs font-semibold text-[var(--danger)]">⚠ {m.error}</div>}
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); ask(input); }} className="flex items-center gap-2 border-t border-[var(--border)] p-3">
        <input
          className="ctl flex-1"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={busy ? "Thinking…" : "Ask about sales, customers, stock, purchases…"}
          disabled={busy}
        />
        <button type="submit" disabled={busy || !input.trim()} className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white hover:bg-[var(--accent-strong)] disabled:opacity-50">
          {busy ? "…" : "Ask"}
        </button>
      </form>
    </div>
  );
}

function ResultTable({ rows }: { rows: Record<string, unknown>[] }) {
  const cols = Object.keys(rows[0] ?? {}).slice(0, 8);
  return (
    <div className="mt-1 max-h-56 overflow-auto rounded border border-[var(--border)]">
      <table className="w-full text-[11px]">
        <thead className="sticky top-0 bg-[var(--surface-2)]">
          <tr>{cols.map((c) => <th key={c} className="px-2 py-1 text-left font-bold">{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.slice(0, 50).map((r, i) => (
            <tr key={i} className="border-t border-[var(--border)]">
              {cols.map((c) => <td key={c} className="px-2 py-1 font-mono">{fmt(r[c])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const fmt = (v: unknown) => v == null ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v);
