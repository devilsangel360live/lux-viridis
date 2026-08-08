"use client";

import type { ClientNode } from "@/lib/api";
import { STATUS_ORDER, STATUS_LABEL, statusColor, type Status } from "./node-visuals";
import { HistoryPanel } from "./history-panel";
import { BacklinksPanel } from "./backlinks-panel";
import { cn, formatCount } from "@/lib/utils";
import { estimatedPages } from "@/lib/stats";

/**
 * The inspector shows the metadata that Scrivener puts on the index card:
 * synopsis, status, POV, target. Fields are type-aware — a character sheet has
 * no POV, a scene has no age.
 */

const FIELDS_BY_TYPE: Record<string, Array<{ key: string; label: string }>> = {
  scene: [
    { key: "pov", label: "POV" },
    { key: "location", label: "Location" },
  ],
  chapter: [
    { key: "pov", label: "POV" },
    { key: "target", label: "Word target" },
  ],
  act: [{ key: "target", label: "Word target" }],
  character: [
    { key: "role", label: "Role" },
    { key: "age", label: "Age" },
    { key: "arc", label: "Arc" },
  ],
  location: [
    { key: "region", label: "Region" },
    { key: "climate", label: "Climate" },
  ],
  lore: [{ key: "category", label: "Category" }],
  beat: [
    { key: "slot", label: "Act" },
    { key: "tension", label: "Tension (1–10)" },
  ],
};

export function Inspector({
  node,
  subtreeWordCount,
  breakdown,
  onPatch,
  onRestored,
  onSelect,
}: {
  node: ClientNode;
  subtreeWordCount: number;
  /** For containers: how many children make up the total. */
  breakdown: { count: number; label: string } | null;
  onPatch: (patch: { synopsis?: string; meta?: Record<string, unknown> }) => void;
  onRestored: () => void;
  onSelect: (id: string) => void;
}) {
  const meta = (node.meta ?? {}) as Record<string, unknown>;
  const fields = FIELDS_BY_TYPE[node.type] ?? [];
  const target = Number(meta.target) || 0;
  const progress = target > 0 ? Math.min(100, (subtreeWordCount / target) * 100) : 0;

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col gap-5 overflow-y-auto border-l border-[var(--border)] bg-[var(--surface)] p-4">
      <div>
        <Label>Synopsis</Label>
        <textarea
          value={node.synopsis ?? ""}
          onChange={(e) => onPatch({ synopsis: e.target.value })}
          rows={5}
          placeholder="What happens, in one or two lines…"
          className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-2.5 text-[13px] leading-relaxed text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
        />
      </div>

      {node.type !== "folder" && (
        <div>
          <Label>Status</Label>
          <div className="flex flex-wrap gap-1">
            {STATUS_ORDER.map((s) => {
              const active = (meta.status as string) === s;
              return (
                <button
                  key={s}
                  onClick={() => onPatch({ meta: { ...meta, status: s } })}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] transition-colors",
                    active
                      ? "border-transparent text-[var(--accent-contrast)]"
                      : "border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text-muted)] hover:border-[var(--border-strong)]",
                  )}
                  style={active ? { background: statusColor(s) } : undefined}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: active ? "currentColor" : statusColor(s) }}
                  />
                  {STATUS_LABEL[s as Status]}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {fields.length > 0 && (
        <div className="space-y-2.5">
          <Label>Details</Label>
          {fields.map((f) => (
            <div key={f.key}>
              <div className="mb-1 text-[11px] text-[var(--text-faint)]">{f.label}</div>
              <input
                value={String(meta[f.key] ?? "")}
                onChange={(e) => onPatch({ meta: { ...meta, [f.key]: e.target.value } })}
                className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-1.5 text-[13px] focus:border-[var(--accent)] focus:outline-none"
              />
            </div>
          ))}
        </div>
      )}

      <div>
        <Label>Words</Label>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-3">
          <div className="flex items-baseline justify-between">
            <span className="font-serif text-2xl tabular-nums">
              {formatCount(subtreeWordCount)}
            </span>
            {target > 0 && (
              <span className="text-[11px] tabular-nums text-[var(--text-faint)]">
                of {formatCount(target)}
              </span>
            )}
          </div>

          {target > 0 && (
            <>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface)]">
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{ width: `${progress}%`, background: "var(--accent)" }}
                />
              </div>
              <div className="mt-1 text-[10px] tabular-nums text-[var(--text-faint)]">
                {subtreeWordCount >= target
                  ? "Target met"
                  : `${formatCount(target - subtreeWordCount)} to go`}
              </div>
            </>
          )}

          {/* For containers, show what the total is actually made of. */}
          {breakdown && breakdown.count > 0 && (
            <div className="mt-2 border-t border-[var(--border)] pt-2 text-[11px] text-[var(--text-muted)]">
              <div className="flex justify-between">
                <span>
                  {breakdown.count} {breakdown.label}
                  {breakdown.count === 1 ? "" : "s"}
                </span>
                <span className="tabular-nums text-[var(--text-faint)]">
                  avg {formatCount(Math.round(subtreeWordCount / breakdown.count))}
                </span>
              </div>
            </div>
          )}

          {/* Below a page the estimate is noise — "~0 pages" reads as a bug. */}
          {estimatedPages(subtreeWordCount) >= 1 && (
            <div className="mt-1 text-[10px] text-[var(--text-faint)]">
              ~{estimatedPages(subtreeWordCount)} page
              {estimatedPages(subtreeWordCount) === 1 ? "" : "s"}
            </div>
          )}
        </div>
      </div>

      {/**
       * Both panels key on the selected node so they refetch when it changes.
       * The keys are prefixed because these are siblings in the same parent and
       * a character renders both — a bare node.id would be the same key twice.
       */}

      {/* Backlinks belong on the things prose refers to. */}
      {(node.type === "character" || node.type === "location" || node.type === "lore") && (
        <BacklinksPanel key={`backlinks:${node.id}`} nodeId={node.id} onSelect={onSelect} />
      )}

      {/* History only makes sense for documents that hold prose. */}
      {node.type !== "folder" && node.type !== "beat" && (
        <HistoryPanel
          key={`history:${node.id}`}
          nodeId={node.id}
          currentWordCount={node.wordCount}
          onRestored={onRestored}
        />
      )}

      <div className="mt-auto text-[11px] text-[var(--text-faint)]">
        <div className="capitalize">Type: {node.type}</div>
        <div>Updated {new Date(node.updatedAt).toLocaleString()}</div>
      </div>
    </aside>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
      {children}
    </div>
  );
}
