"use client";

import { useEffect, useState } from "react";

interface Health {
  configured: boolean;
  ok: boolean;
  banner?: string;
  error?: string;
  message?: string;
}

export default function ConnectionStatus() {
  const [h, setH] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);

  async function check() {
    setLoading(true);
    try {
      const d = await fetch("/api/health", { cache: "no-store" }).then((r) => r.json());
      setH(d);
    } catch (e) {
      setH({ configured: true, ok: false, error: String(e) });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    check();
  }, []);

  const tone = !h
    ? "muted"
    : h.ok
      ? "ok"
      : h.configured
        ? "danger"
        : "warning";
  const color =
    tone === "ok"
      ? "var(--accent-2)"
      : tone === "danger"
        ? "var(--danger)"
        : tone === "warning"
          ? "var(--warning)"
          : "var(--muted)";

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="h-3 w-3 rounded-full" style={{ background: color }} />
          <span className="font-medium">
            {loading
              ? "Checking…"
              : h?.ok
                ? "Connected — live Oracle data"
                : h?.configured
                  ? "Configured, but not reachable"
                  : "Not configured (sample data mode)"}
          </span>
        </div>
        <button
          onClick={check}
          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs hover:bg-[var(--surface-2)]"
        >
          Re-check
        </button>
      </div>
      {h?.banner && <p className="mt-3 font-mono text-xs text-[var(--muted)]">{h.banner}</p>}
      {h?.error && <p className="mt-3 font-mono text-xs text-[var(--danger)]">{h.error}</p>}
      {h?.message && !h.ok && (
        <p className="mt-3 text-sm text-[var(--muted)]">{h.message}</p>
      )}
    </div>
  );
}
