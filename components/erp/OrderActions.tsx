"use client";

// Print + WhatsApp actions for the order detail page (client-side only).

export function PrintButton() {
  return (
    <button onClick={() => window.print()}
      className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-bold hover:bg-[var(--surface-2)] no-print">
      🖨 Print
    </button>
  );
}

export function WhatsappButton({ phone, message }: { phone: string; message: string }) {
  const digits = String(phone || "").replace(/\D/g, "");
  const to = digits.length === 10 ? `91${digits}` : digits; // default India country code
  const href = `https://wa.me/${to}?text=${encodeURIComponent(message)}`;
  if (!to) {
    return <span className="text-xs font-semibold text-[var(--muted-2)] no-print">No phone on file for WhatsApp</span>;
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="rounded-lg border border-[#25D366] bg-[#25D366]/10 px-3 py-1.5 text-sm font-bold text-[#128C7E] hover:bg-[#25D366]/20 no-print">
      🟢 WhatsApp
    </a>
  );
}
