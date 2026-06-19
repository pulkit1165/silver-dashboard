import Logo from "@/components/Logo";
import LoginForm from "@/components/erp/LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)] px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <Logo size={64} className="rounded-2xl shadow-md" />
          <div>
            <h1 className="text-xl font-extrabold tracking-tight">Silver Up Auto Parts</h1>
            <p className="text-sm font-medium text-[var(--muted)]">ERP — sign in to continue</p>
          </div>
        </div>
        <div className="panel p-6">
          <LoginForm next={next} />
        </div>
        <p className="mt-4 text-center text-xs text-[var(--muted)]">
          Authorised users only · all activity is audited.
        </p>
      </div>
    </div>
  );
}
