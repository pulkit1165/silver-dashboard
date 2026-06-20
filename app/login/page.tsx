import Logo from "@/components/Logo";
import LoginForm from "@/components/erp/LoginForm";
import LoginBackground from "@/components/erp/LoginBackground";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* base + fallback gradient (shows if WebGL/reduced-motion) */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(1100px 760px at 28% 18%, rgba(204,31,45,0.12), transparent 60%)," +
            "radial-gradient(900px 700px at 82% 88%, rgba(60,70,90,0.10), transparent 60%)," +
            "radial-gradient(circle at 50% 45%, #ffffff 0%, #eceef1 70%, #e2e4e8 100%)",
        }}
      />
      {/* animated 3D bike parts */}
      <LoginBackground />
      {/* subtle vignette for contrast/readability */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(circle at 50% 50%, transparent 45%, rgba(20,20,28,0.10) 100%)" }}
      />

      {/* foreground: login card */}
      <div className="relative z-10 flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="rounded-2xl border border-white/60 bg-white/75 p-6 shadow-[0_20px_60px_rgba(20,20,30,0.18)] backdrop-blur-xl">
            <div className="mb-6 flex flex-col items-center gap-3 text-center">
              <Logo size={64} className="rounded-2xl shadow-md" />
              <div>
                <h1 className="text-xl font-extrabold tracking-tight">Silver Up Auto Parts</h1>
                <p className="text-sm font-medium text-[var(--muted)]">ERP — sign in to continue</p>
              </div>
            </div>
            <LoginForm next={next} />
          </div>
          <p className="mt-4 text-center text-xs font-medium text-[var(--muted)]">
            Authorised users only · all activity is audited.
          </p>
        </div>
      </div>
    </div>
  );
}
