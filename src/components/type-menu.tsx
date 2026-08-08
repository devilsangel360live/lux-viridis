"use client";

import { Check, Type } from "lucide-react";

import {
  FONTS,
  LEADING_MAX,
  LEADING_MIN,
  SIZE_MAX,
  SIZE_MIN,
  type TypeSettings,
} from "@/lib/fonts";
import { cn } from "@/lib/utils";

/**
 * Writing-canvas typography: face, size and line spacing.
 *
 * Each face is previewed in itself rather than named in the interface font —
 * the only way to choose a typeface is to see it.
 */
export function TypeMenu({
  open,
  settings,
  onChange,
  onToggle,
}: {
  open: boolean;
  settings: TypeSettings;
  onChange: (next: TypeSettings) => void;
  onToggle: () => void;
}) {
  return (
    <div className="relative">
      <button
        onClick={onToggle}
        aria-label="Typography"
        title="Typography"
        aria-pressed={open}
        className={cn(
          "grid h-7 w-7 shrink-0 place-items-center rounded-md transition-colors",
          open
            ? "bg-[var(--accent-soft)] text-[var(--accent)]"
            : "text-[var(--text-faint)] hover:bg-[var(--surface)] hover:text-[var(--text)]",
        )}
      >
        <Type className="h-4 w-4" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={onToggle} />
          <div className="animate-fade-in absolute right-0 top-9 z-40 w-64 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] shadow-[var(--shadow-pop)]">
            <div className="border-b border-[var(--border)] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
              Writing font
            </div>

            <ul className="max-h-64 overflow-y-auto py-1">
              {FONTS.map((font) => {
                const active = settings.font === font.id;
                return (
                  <li key={font.id}>
                    <button
                      onClick={() => onChange({ ...settings, font: font.id })}
                      className={cn(
                        "flex w-full items-start gap-2 px-3 py-2 text-left transition-colors",
                        active ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--surface)]",
                      )}
                    >
                      <Check
                        className={cn(
                          "mt-1 h-3 w-3 shrink-0",
                          active ? "text-[var(--accent)]" : "invisible",
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        {/* Previewed in its own face. */}
                        <span
                          className="block truncate text-[15px] leading-tight"
                          style={{ fontFamily: font.stack }}
                        >
                          {font.label}
                        </span>
                        <span className="mt-0.5 block text-[10px] leading-snug text-[var(--text-faint)]">
                          {font.hint}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="space-y-2.5 border-t border-[var(--border)] px-3 py-2.5">
              <Slider
                label="Size"
                value={settings.size}
                min={SIZE_MIN}
                max={SIZE_MAX}
                step={0.025}
                display={`${Math.round(settings.size * 16)}px`}
                onChange={(size) => onChange({ ...settings, size })}
              />
              <Slider
                label="Line spacing"
                value={settings.leading}
                min={LEADING_MIN}
                max={LEADING_MAX}
                step={0.05}
                display={settings.leading.toFixed(2)}
                onChange={(leading) => onChange({ ...settings, leading })}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline justify-between text-[11px] text-[var(--text-muted)]">
        {label}
        <span className="tabular-nums text-[var(--text-faint)]">{display}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--accent)]"
      />
    </label>
  );
}
