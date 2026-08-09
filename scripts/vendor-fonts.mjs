/**
 * Downloads the writing-canvas typefaces into `src/app/fonts/`.
 *
 * `next/font/google` fetches from fonts.googleapis.com at *build* time, which
 * fails inside a Docker builder with no egress. Vendoring the woff2 files makes
 * the build hermetic; run this only when adding a family or refreshing a
 * version, never as part of the build.
 *
 *     node scripts/vendor-fonts.mjs
 *
 * Only the `latin` subset is kept, matching the `subsets: ["latin"]` the
 * next/font calls used to request — pulling every subset would multiply the
 * bundle for glyphs this app never renders.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "app",
  "fonts",
);

/**
 * A modern desktop UA is required: Google serves ttf to unrecognised clients
 * and woff2 only to browsers it knows.
 */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * The editor renders bold and italic, so every family needs all four faces.
 * Atkinson ships 400/700 rather than 600, and JetBrains Mono is listed under
 * its own name — both are spelled out here rather than inferred.
 */
const FAMILIES = [
  { name: "Inter", slug: "inter", weights: [400, 600], italics: false },
  { name: "Literata", slug: "literata", weights: [400, 600], italics: true },
  { name: "EB Garamond", slug: "eb-garamond", weights: [400, 600], italics: true },
  { name: "Spectral", slug: "spectral", weights: [400, 600], italics: true },
  { name: "Lora", slug: "lora", weights: [400, 600], italics: true },
  { name: "Newsreader", slug: "newsreader", weights: [400, 600], italics: true },
  { name: "JetBrains Mono", slug: "jetbrains-mono", weights: [400, 600], italics: true },
  {
    name: "Atkinson Hyperlegible",
    slug: "atkinson-hyperlegible",
    weights: [400, 700],
    italics: true,
  },
];

function cssUrl(family) {
  const { name, weights, italics } = family;
  const axis = italics ? "ital,wght@" : "wght@";
  const spec = italics
    ? [...weights.map((w) => `0,${w}`), ...weights.map((w) => `1,${w}`)].join(";")
    : weights.join(";");
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g, "+")}:${axis}${spec}&display=swap`;
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.text();
}

/**
 * Splits the stylesheet into @font-face blocks, keeping only the one Google
 * labels `/* latin *​/`. The comment precedes its block, so the marker is
 * carried forward as the blocks are scanned.
 */
function latinFaces(css) {
  const faces = [];
  const re = /\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    const [, subset, body] = m;
    if (subset !== "latin") continue;
    const url = body.match(/src:\s*url\(([^)]+)\)/)?.[1];
    const weight = body.match(/font-weight:\s*(\d+)/)?.[1];
    const style = body.match(/font-style:\s*(\w+)/)?.[1] ?? "normal";
    if (!url || !weight) continue;
    faces.push({ url, weight, style });
  }
  return faces;
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const written = [];

  for (const family of FAMILIES) {
    const css = await fetchText(cssUrl(family));
    const faces = latinFaces(css);
    if (faces.length === 0) {
      throw new Error(`No latin @font-face found for ${family.name}`);
    }

    for (const face of faces) {
      const suffix = face.style === "italic" ? "-italic" : "";
      const file = `${family.slug}-${face.weight}${suffix}.woff2`;
      const res = await fetch(face.url, { headers: { "User-Agent": UA } });
      if (!res.ok) throw new Error(`GET ${face.url} -> ${res.status}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      await fs.writeFile(path.join(OUT_DIR, file), bytes);
      written.push({ file, bytes: bytes.length });
      console.log(`  ${file}  ${(bytes.length / 1024).toFixed(1)} KB`);
    }
  }

  const total = written.reduce((sum, w) => sum + w.bytes, 0);
  console.log(
    `\n${written.length} files, ${(total / 1024).toFixed(0)} KB total -> src/app/fonts/`,
  );
}

await main();
