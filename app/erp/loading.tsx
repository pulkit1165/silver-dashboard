// Shown instantly on every /erp/* navigation while the server fetches data.
// The sidebar (in the root layout) stays put; only this content area swaps in,
// so opening a section feels immediate instead of blank for ~1s.
const Bar = ({ className = "" }: { className?: string }) => (
  <div className={`rounded-md bg-[var(--surface-2)] ${className}`} />
);

export default function ErpLoading() {
  return (
    <div className="animate-pulse">
      {/* page header */}
      <div className="mb-6">
        <Bar className="h-7 w-56" />
        <Bar className="mt-3 h-4 w-80 max-w-full" />
      </div>

      {/* KPI strip */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <Bar className="h-3 w-20" />
            <Bar className="mt-3 h-7 w-14" />
            <Bar className="mt-3 h-3 w-24" />
          </div>
        ))}
      </div>

      {/* main panel with table rows */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <div className="border-b border-[var(--border)] p-4"><Bar className="h-4 w-40" /></div>
        <div className="divide-y divide-[var(--border)]">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 p-4">
              <Bar className="h-4 w-1/4" />
              <Bar className="h-4 w-1/5" />
              <Bar className="h-4 w-1/6" />
              <Bar className="ml-auto h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
