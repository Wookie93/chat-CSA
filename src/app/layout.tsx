import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Navbar } from "@/components/Navbar";
import { Sidebar } from "@/components/Sidebar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Chat App",
  description: "Secure dynamic chat application",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
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
