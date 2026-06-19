"use client";

import { useState } from "react";

export default function LoginForm({ next }: { next?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/erp/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const d = await r.json();
      if (d.ok) {
        // full navigation so middleware + layout re-evaluate the session
        window.location.href = next && next.startsWith("/") ? next : "/erp";
      } else {
        setErr(d.error ?? "Sign in failed.");
      }
    } catch {
      setErr("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--muted)]">
        Email
        <input
          type="email" autoComplete="username" required value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
          placeholder="you@silver.local"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--muted)]">
        Password
        <input
          type="password" autoComplete="current-password" required value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
          placeholder="••••••••"
        />
      </label>
      {err && <div className="rounded-lg border border-[var(--danger)] bg-[var(--danger-bg)] px-3 py-2 text-sm font-semibold text-[var(--danger)]">{err}</div>}
      <button
        disabled={busy}
        className="mt-1 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-bold text-white hover:bg-[var(--accent-strong)] disabled:opacity-60"
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
