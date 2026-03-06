// =================================================================
// Root Layout — Loom
// =================================================================
// Sets up the HTML shell, global CSS, font loading, and
// the dark-mode class on <html>. All pages render inside this.
// =================================================================

import type { Metadata } from "next";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "Loom — Data Storyteller",
  description: "Local-first data storytelling for macOS",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <link
          rel="preconnect"
          href="https://fonts.googleapis.com"
        />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased overflow-hidden">
        {children}
      </body>
    </html>
  );
}
