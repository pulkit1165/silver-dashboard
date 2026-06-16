export default function PageHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[1.7rem] font-extrabold leading-none tracking-tight">{title}</h1>
        {subtitle && <p className="mt-2 text-sm font-medium text-[var(--muted)]">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}
