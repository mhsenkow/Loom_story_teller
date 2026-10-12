// =================================================================
// Root Layout — Loom
// =================================================================
// HTML shell, global CSS, font loading for look system catalog.
// Themes applied via ThemeApplicator (data-theme on <html>).
// =================================================================

import type { Metadata, Viewport } from "next";
import "@/styles/globals.css";
import { SHELL_BOOTSTRAP_SCRIPT } from "@/lib/shellBootstrap";
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/themeBootstrap";

export const metadata: Metadata = {
  metadataBase: new URL("https://loom.ibm.io"),
  alternates: { canonical: "/" },
  title: "Loom — turn live data into shareable charts",
  description:
    "Import CSV or discover live quakes, flights, and markets—build charts on your device and share a link from the browser.",
  formatDetection: { telephone: false, address: false, email: false },
  icons: {
    icon: [
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    title: "Loom — turn live data into shareable charts",
    description:
      "Import CSV or discover live quakes, flights, and markets—build charts on your device and share a link from the browser.",
    url: "https://loom.ibm.io",
    siteName: "Loom",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Loom data storytelling" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Loom — turn live data into shareable charts",
    description:
      "Import CSV or discover live quakes, flights, and markets—build charts on your device and share a link from the browser.",
    images: ["/og.png"],
  },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Keep bottom-sheet inputs above the on-screen keyboard (Chrome / Android; iOS ignores).
  interactiveWidget: "resizes-content",
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
    <html lang="en" data-theme="dark" data-ui="noyes" data-font="inter" data-faces="local" className="dark">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: SHELL_BOOTSTRAP_SCRIPT }} />
      </head>
      <body className="antialiased min-h-dvh overflow-x-hidden overflow-y-auto md:overflow-hidden">{children}</body>
    </html>
  );
}
