import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { OG_IMAGE } from "@/brand/meta";
import { RESTORE_SCRIPT } from "@/restore/boot";
import { THEME_COLOR, THEME_SCRIPT } from "@/theme/theme";
import { ThemeSync } from "@/theme/ThemeSync";
import "./globals.css";

// Silkscreen (OFL), cut to the stat numbers by scripts/subset_pixel_font.py (about 3.4 kB).
const pixel = localFont({
  src: "../fonts/pixel-gatho.woff2",
  variable: "--font-pixel",
  weight: "400",
  display: "swap",
  fallback: ["monospace"],
});

const DESCRIPTION = "Running routes that are the distance you asked for, through the places you choose.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: { default: "GATHO", template: "%s · GATHO" },
  description: DESCRIPTION,
  applicationName: "GATHO",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "16x16 32x32" },
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: { url: "/icons/icon-180.png", sizes: "180x180" },
  },
  openGraph: { siteName: "GATHO", type: "website", title: "GATHO", description: DESCRIPTION, images: [OG_IMAGE] },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: THEME_COLOR.light,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-theme is set by THEME_SCRIPT before first paint, so the server's "light" may differ: expected.
    <html lang="en" data-theme="light" className={pixel.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: RESTORE_SCRIPT }} />
      </head>
      <body>
        <ThemeSync />
        {children}
      </body>
    </html>
  );
}
