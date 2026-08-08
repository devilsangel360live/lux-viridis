"use client";

import { BookMarked, Compass, Search, Trash2, Waypoints } from "lucide-react";

import type { NodeRoot } from "@/db/schema";
import { cn } from "@/lib/utils";

/**
 * The activity rail: a narrow column of mode icons that decides what the wider
 * second column shows. Modes are the three node roots plus search, which is a
 * view rather than a tree and so has no root of its own.
 */

export type RailMode = NodeRoot | "search";

export const RAIL_ITEMS: Array<{
  mode: RailMode;
  label: string;
  hint: string;
  icon: typeof BookMarked;
}> = [
  {
    mode: "manuscript",
    label: "Manuscript",
    hint: "Acts, chapters and scenes in reading order",
    icon: BookMarked,
  },
  {
    mode: "world",
    label: "World",
    hint: "Characters, locations and lore",
    icon: Compass,
  },
  {
    mode: "planning",
    label: "Planning",
    hint: "Story beats and structural notes",
    icon: Waypoints,
  },
  {
    mode: "search",
    label: "Search",
    hint: "Find text across the whole project",
    icon: Search,
  },
  {
    mode: "trash",
    label: "Trash",
    hint: "Deleted items — restore them or remove for good",
    icon: Trash2,
  },
];

export function Rail({
  mode,
  open,
  onSelect,
}: {
  mode: RailMode;
  open: boolean;
  onSelect: (mode: RailMode) => void;
}) {
  return (
    <nav
      aria-label="Sections"
      className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-[var(--border)] bg-[var(--surface)] py-2"
    >
      {RAIL_ITEMS.map((item) => {
        const active = mode === item.mode;
        const Icon = item.icon;
        return (
          <button
            key={item.mode}
            onClick={() => onSelect(item.mode)}
            aria-label={item.label}
            aria-current={active ? "page" : undefined}
            // aria-expanded describes the tree column this button controls, so
            // the collapse behaviour is announced rather than purely visual.
            aria-expanded={active ? open : undefined}
            className={cn(
              "group relative grid h-9 w-9 place-items-center rounded-lg transition-colors",
              active && open
                ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                : "text-[var(--text-faint)] hover:bg-[var(--surface-raised)] hover:text-[var(--text)]",
            )}
          >
            {/* Active marker rides the rail edge, VS Code style. */}
            <span
              className={cn(
                "absolute left-[-8px] h-5 w-[2px] rounded-full transition-opacity",
                active ? "opacity-100" : "opacity-0",
              )}
              style={{ background: "var(--accent)" }}
            />
            <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />

            <span
              role="tooltip"
              className="pointer-events-none absolute left-11 z-50 hidden w-max max-w-[220px] rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-2.5 py-1.5 text-left shadow-[var(--shadow-pop)] group-hover:block"
            >
              <span className="block text-[12px] font-medium text-[var(--text)]">
                {item.label}
              </span>
              <span className="mt-0.5 block text-[11px] leading-snug text-[var(--text-muted)]">
                {item.hint}
              </span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}
