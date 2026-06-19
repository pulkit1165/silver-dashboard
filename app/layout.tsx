import type { Metadata } from "next";
import { Manrope, Geist_Mono } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import { getSessionUser } from "@/lib/erp/session";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Silver Up Auto Parts — ERP",
  description: "Operations ERP for Silver Up Auto Parts: inventory, sales, purchase, dispatch, QR scanning.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await getSessionUser();
  return (
    <html lang="en" className={`${manrope.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        {user ? (
          <div className="flex min-h-screen">
            <Sidebar user={user} />
            <main className="min-w-0 flex-1 px-4 pb-10 pt-20 sm:px-6 md:pt-7 lg:px-10">
              <div className="mx-auto w-full max-w-[1400px]">{children}</div>
            </main>
          </div>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
