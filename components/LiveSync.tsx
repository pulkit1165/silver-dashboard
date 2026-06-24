"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Whole-ERP live sync: polls a tiny change-fingerprint and, when anything in the
 * database changes, calls router.refresh() so every signed-in device re-renders
 * the current page with fresh data within a couple of seconds. No extra infra.
 */
export default function LiveSync() {
  const router = useRouter();
  const last = useRef<string | null>(null);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const r = await fetch("/api/erp/live", { cache: "no-store" });
        const d = await r.json();
        setOnline(true);
        if (last.current === null) last.current = d.v;
        else if (d.v && d.v !== last.current) {
          last.current = d.v;
          router.refresh();
        }
      } catch {
        setOnline(false);
      }
      if (!stopped) timer = setTimeout(poll, document.hidden ? 8000 : 2500);
    };
    poll();

    const onVis = () => {
      if (!document.hidden) { clearTimeout(timer); poll(); }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => { stopped = true; clearTimeout(timer); document.removeEventListener("visibilitychange", onVis); };
  }, [router]);

  return (
    <div className="pointer-events-none fixed bottom-3 left-3 z-30 flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)]/90 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--muted)] shadow-sm backdrop-blur">
      <span className={`h-1.5 w-1.5 rounded-full ${online ? "animate-pulse bg-[var(--accent-2)]" : "bg-[var(--muted-2)]"}`} />
      {online ? "Live" : "Offline"}
    </div>
  );
}
