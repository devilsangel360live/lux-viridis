import type { Metadata } from "next";
import {
  Atkinson_Hyperlegible,
  EB_Garamond,
  Inter,
  JetBrains_Mono,
  Literata,
  Lora,
  Newsreader,
  Spectral,
} from "next/font/google";

import "./globals.css";

/**
 * next/font self-hosts these at build time — nothing is requested from Google
 * at runtime, which matters for a self-hosted instance behind a tunnel.
 *
 * Only the two chrome faces (Inter, Literata) are attached to <body> as
 * defaults; the rest simply define their CSS variables so the canvas can switch
 * between them without a reload.
 */

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });

const literata = Literata({
  variable: "--font-literata",
  subsets: ["latin"],
  display: "swap",
});

const garamond = EB_Garamond({
  variable: "--font-garamond",
  subsets: ["latin"],
  display: "swap",
});

const spectral = Spectral({
  variable: "--font-spectral",
  subsets: ["latin"],
  weight: ["400", "600"],
  display: "swap",
});

const lora = Lora({ variable: "--font-lora", subsets: ["latin"], display: "swap" });

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  display: "swap",
});

const monoWriting = JetBrains_Mono({
  variable: "--font-mono-writing",
  subsets: ["latin"],
  display: "swap",
});

const atkinson = Atkinson_Hyperlegible({
  variable: "--font-atkinson",
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
});

const FONT_VARIABLES = [
  inter,
  literata,
  garamond,
  spectral,
  lora,
  newsreader,
  monoWriting,
  atkinson,
]
  .map((f) => f.variable)
  .join(" ");

export const metadata: Metadata = {
  title: "Lux Viridis",
  description: "A writing and planning workspace for novels.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <body className={`${FONT_VARIABLES} antialiased`}>{children}</body>
    </html>
  );
}
