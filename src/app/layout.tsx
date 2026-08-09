import type { Metadata } from "next";
import localFont from "next/font/local";

import "./globals.css";

/**
 * The typefaces are vendored into `./fonts` and loaded with next/font/local
 * rather than next/font/google. The Google loader downloads from
 * fonts.googleapis.com at *build* time, which fails in a Docker builder that
 * has no outbound network — so the files live in the repo and the build stays
 * hermetic. `scripts/vendor-fonts.mjs` refreshes them.
 *
 * Only the two chrome faces (Inter, Literata) are attached to <body> as
 * defaults; the rest simply define their CSS variables so the canvas can switch
 * between them without a reload.
 */

const inter = localFont({
  variable: "--font-inter",
  display: "swap",
  src: [
    { path: "./fonts/inter-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/inter-600.woff2", weight: "600", style: "normal" },
  ],
});

const literata = localFont({
  variable: "--font-literata",
  display: "swap",
  src: [
    { path: "./fonts/literata-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/literata-600.woff2", weight: "600", style: "normal" },
    { path: "./fonts/literata-400-italic.woff2", weight: "400", style: "italic" },
    { path: "./fonts/literata-600-italic.woff2", weight: "600", style: "italic" },
  ],
});

const garamond = localFont({
  variable: "--font-garamond",
  display: "swap",
  src: [
    { path: "./fonts/eb-garamond-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/eb-garamond-600.woff2", weight: "600", style: "normal" },
    { path: "./fonts/eb-garamond-400-italic.woff2", weight: "400", style: "italic" },
    { path: "./fonts/eb-garamond-600-italic.woff2", weight: "600", style: "italic" },
  ],
});

const spectral = localFont({
  variable: "--font-spectral",
  display: "swap",
  src: [
    { path: "./fonts/spectral-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/spectral-600.woff2", weight: "600", style: "normal" },
    { path: "./fonts/spectral-400-italic.woff2", weight: "400", style: "italic" },
    { path: "./fonts/spectral-600-italic.woff2", weight: "600", style: "italic" },
  ],
});

const lora = localFont({
  variable: "--font-lora",
  display: "swap",
  src: [
    { path: "./fonts/lora-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/lora-600.woff2", weight: "600", style: "normal" },
    { path: "./fonts/lora-400-italic.woff2", weight: "400", style: "italic" },
    { path: "./fonts/lora-600-italic.woff2", weight: "600", style: "italic" },
  ],
});

const newsreader = localFont({
  variable: "--font-newsreader",
  display: "swap",
  src: [
    { path: "./fonts/newsreader-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/newsreader-600.woff2", weight: "600", style: "normal" },
    { path: "./fonts/newsreader-400-italic.woff2", weight: "400", style: "italic" },
    { path: "./fonts/newsreader-600-italic.woff2", weight: "600", style: "italic" },
  ],
});

const monoWriting = localFont({
  variable: "--font-mono-writing",
  display: "swap",
  src: [
    { path: "./fonts/jetbrains-mono-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/jetbrains-mono-600.woff2", weight: "600", style: "normal" },
    { path: "./fonts/jetbrains-mono-400-italic.woff2", weight: "400", style: "italic" },
    { path: "./fonts/jetbrains-mono-600-italic.woff2", weight: "600", style: "italic" },
  ],
});

const atkinson = localFont({
  variable: "--font-atkinson",
  display: "swap",
  src: [
    { path: "./fonts/atkinson-hyperlegible-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/atkinson-hyperlegible-700.woff2", weight: "700", style: "normal" },
    {
      path: "./fonts/atkinson-hyperlegible-400-italic.woff2",
      weight: "400",
      style: "italic",
    },
    {
      path: "./fonts/atkinson-hyperlegible-700-italic.woff2",
      weight: "700",
      style: "italic",
    },
  ],
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
