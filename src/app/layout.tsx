// =================================================================
// Root Layout — Loom
// =================================================================
// HTML shell, global CSS, font loading for look system catalog.
// Themes applied via ThemeApplicator (data-theme on <html>).
// =================================================================

import type { Metadata, Viewport } from "next";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "Loom — Data Storyteller",
  description: "Local-first data storytelling — explore, chart, and share.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f2f0" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0c" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="dark" data-ui="noyes" data-font="inter" data-faces="auto" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Josefin+Sans:wght@400;600;700&family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Lora:ital,wght@0,400;0,600;0,700;1,400&family=Oswald:wght@400;600;700&family=Source+Code+Pro:wght@400;500;600&family=Source+Sans+3:wght@400;600;700&family=Space+Mono:wght@400;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased overflow-hidden">{children}</body>
    </html>
  );
}
