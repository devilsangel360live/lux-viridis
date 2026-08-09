/**
 * The writing-canvas typefaces.
 *
 * Bundled rather than uploadable on purpose: accepting arbitrary font binaries
 * on a family server means parsing untrusted files, storing them, and taking on
 * whatever licence they carry — a lot of surface for a preference. These eight
 * are all open-licensed and cover the ranges writers actually ask for.
 *
 * The CSS variables are declared in layout.tsx via next/font/local, reading
 * woff2 files vendored under `src/app/fonts/`; nothing is fetched from Google
 * at build time or at runtime.
 */

export type FontId =
  | "literata"
  | "garamond"
  | "spectral"
  | "lora"
  | "newsreader"
  | "typewriter"
  | "inter"
  | "atkinson";

export type FontChoice = {
  id: FontId;
  label: string;
  /** Shown under the name so the choice is meaningful, not just a word. */
  hint: string;
  /** CSS font-family value, referencing the variable next/font defines. */
  stack: string;
};

export const FONTS: FontChoice[] = [
  {
    id: "literata",
    label: "Literata",
    hint: "Designed for long reading. The default.",
    stack: "var(--font-literata), Georgia, serif",
  },
  {
    id: "garamond",
    label: "EB Garamond",
    hint: "Classic old-style; feels like a printed book.",
    stack: "var(--font-garamond), Garamond, Georgia, serif",
  },
  {
    id: "spectral",
    label: "Spectral",
    hint: "Modern serif, a little sharper on screen.",
    stack: "var(--font-spectral), Georgia, serif",
  },
  {
    id: "lora",
    label: "Lora",
    hint: "Warm serif with calligraphic roots.",
    stack: "var(--font-lora), Georgia, serif",
  },
  {
    id: "newsreader",
    label: "Newsreader",
    hint: "Editorial serif; good for fast drafting.",
    stack: "var(--font-newsreader), Georgia, serif",
  },
  {
    id: "typewriter",
    label: "Typewriter",
    hint: "Monospaced, like a manuscript page.",
    stack: "var(--font-mono-writing), 'Courier New', monospace",
  },
  {
    id: "inter",
    label: "Inter",
    hint: "Clean sans-serif, no ornament.",
    stack: "var(--font-inter), system-ui, sans-serif",
  },
  {
    id: "atkinson",
    label: "Atkinson Hyperlegible",
    hint: "Built for maximum legibility; letters are hard to confuse.",
    stack: "var(--font-atkinson), system-ui, sans-serif",
  },
];

export const DEFAULT_FONT: FontId = "literata";

export function fontById(id: string | null | undefined): FontChoice {
  return FONTS.find((f) => f.id === id) ?? FONTS[0];
}

/** Canvas text size, in rem. */
export const SIZE_MIN = 0.95;
export const SIZE_MAX = 1.5;
export const SIZE_DEFAULT = 1.125;

export const LEADING_MIN = 1.4;
export const LEADING_MAX = 2.2;
export const LEADING_DEFAULT = 1.75;

export type TypeSettings = {
  font: FontId;
  size: number;
  leading: number;
};

export const DEFAULT_TYPE: TypeSettings = {
  font: DEFAULT_FONT,
  size: SIZE_DEFAULT,
  leading: LEADING_DEFAULT,
};

const STORAGE_KEY = "lv.type";

/**
 * Stored in localStorage rather than the database: it is a per-reader comfort
 * setting, like zoom, and should follow the person rather than the manuscript.
 */
export function loadTypeSettings(): TypeSettings {
  if (typeof window === "undefined") return DEFAULT_TYPE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_TYPE;
    const parsed = JSON.parse(raw) as Partial<TypeSettings>;
    return {
      font: fontById(parsed.font).id,
      size: clamp(Number(parsed.size) || SIZE_DEFAULT, SIZE_MIN, SIZE_MAX),
      leading: clamp(Number(parsed.leading) || LEADING_DEFAULT, LEADING_MIN, LEADING_MAX),
    };
  } catch {
    return DEFAULT_TYPE;
  }
}

export function saveTypeSettings(settings: TypeSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // A full or blocked storage quota must not break writing.
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
