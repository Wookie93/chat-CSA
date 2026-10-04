import { requireAppAccess } from "@/lib/access";
import type { Metadata } from "next";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Navbar } from "@/components/Navbar";
import { Sidebar } from "@/components/Sidebar";

export const metadata: Metadata = {
  title: "Chat App",
  description: "Secure dynamic chat application",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await requireAppAccess();
  return (
    <html lang="en">
      <body
        className="antialiased"
      >
        <ErrorBoundary>
          <div className="h-screen flex flex-col max-w-[1920px] mx-auto w-full">
            <Navbar />
            <div className="flex flex-1 min-h-0">
              <Sidebar />
              <main className="flex-1 flex flex-col min-w-0 py-4 px-4">
                {children}
              </main>
            </div>
          </div>
        </ErrorBoundary>
        <Toaster />
      </body>
    </html>
  );
}
