# Shared Layouts

## App Layout (`src/app/layout.tsx`)
Root layout wrapping pages with header/nav/sidebar structure.

```tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/Sidebar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Inovax Workspace",
  description: "AI-powered workplace and translation workspace",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased flex h-screen bg-background text-foreground overflow-hidden`}>
        <Sidebar />
        <main className="flex-1 flex flex-col min-w-0 overflow-auto">
          {children}
        </main>
      </body>
    </html>
  );
}
```

## Navigation Sidebar (`src/components/Sidebar.tsx`)
Application navigation sidebar with links to Chat, Translator, and Admin.

```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageSquare, Languages, Settings } from "lucide-react";

export default function Sidebar() {
  const pathname = usePathname();

  const navItems = [
    { href: "/chat", label: "Chat", icon: MessageSquare },
    { href: "/translator", label: "Translator", icon: Languages },
    { href: "/admin", label: "Admin Settings", icon: Settings },
  ];

  return (
    <aside className="w-64 border-r border-border bg-sidebar text-sidebar-foreground flex flex-col p-4">
      <div className="flex items-center gap-2 font-bold text-xl px-2 py-4">
        <span>Inovax App</span>
      </div>
      <nav className="flex-1 space-y-1 py-4">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold"
                  : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
              }`}
            >
              <Icon className="w-4 h-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
```
