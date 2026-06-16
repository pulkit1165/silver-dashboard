export default function Card({
  title,
  children,
  className = "",
  right,
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
  right?: React.ReactNode;
}) {
  return (
    <section className={`panel ${className}`}>
      {title && (
        <div className="panel-hd">
          <span className="flex-1">{title}</span>
          {right}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}
