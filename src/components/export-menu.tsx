"use client";

import { useState } from "react";
import { Download, FileText, Loader2 } from "lucide-react";

import type { ClientNode } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Export menu: pick what to export, then a format.
 *
 * The download runs through fetch rather than a plain link so failures surface
 * as a message instead of a browser error page, and so the button can show
 * progress on a long manuscript.
 */

type Kind = "manuscript" | "selection" | "bible" | "outline";

export function ExportMenu({
  projectId,
  selected,
}: {
  projectId: string;
  selected: ClientNode | null;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canExportSelection =
    selected !== null && selected.root === "manuscript" && selected.type !== "card";

  async function download(kind: Kind, format: "docx" | "pdf") {
    const key = `${kind}:${format}`;
    if (busy) return;
    setBusy(key);
    setError(null);

    try {
      const params = new URLSearchParams({ projectId, kind, format });
      if (kind === "selection" && selected) params.set("nodeId", selected.id);

      const res = await fetch(`/api/export?${params}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error === "nothing to export" ? "Nothing to export yet." : "Export failed.");
        return;
      }

      const blob = await res.blob();
      const name =
        res.headers
          .get("content-disposition")
          ?.match(/filename="(.+)"/)?.[1] ?? `export.${format}`;

      // Anchor + object URL is the only way to name a downloaded blob.
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setOpen(false);
    } catch {
      setError("Export failed.");
    } finally {
      setBusy(null);
    }
  }

  const rows: Array<{ kind: Kind; label: string; hint: string; disabled?: boolean }> = [
    { kind: "manuscript", label: "Whole book", hint: "Every chapter in order" },
    {
      kind: "selection",
      label: selected && canExportSelection ? `“${truncate(selected.title)}”` : "Selected item",
      hint: canExportSelection ? "This chapter or scene" : "Select a chapter or scene first",
      disabled: !canExportSelection,
    },
    { kind: "bible", label: "Story bible", hint: "Characters, places and lore" },
    { kind: "outline", label: "Outline", hint: "Synopses and status, no prose" },
  ];

  return (
    <div className="relative">
      <button
        onClick={() => {
          setOpen((v) => !v);
          setError(null);
        }}
        aria-label="Export"
        title="Export"
        className={cn(
          "grid h-7 w-7 shrink-0 place-items-center rounded-md transition-colors",
          open
            ? "bg-[var(--accent-soft)] text-[var(--accent)]"
            : "text-[var(--text-faint)] hover:bg-[var(--surface)] hover:text-[var(--text)]",
        )}
      >
        <Download className="h-4 w-4" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="animate-fade-in absolute right-0 top-9 z-40 w-72 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] shadow-[var(--shadow-pop)]">
            <div className="border-b border-[var(--border)] px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
                Export
              </div>
            </div>

            <div className="py-1">
              {rows.map((row) => (
                <div
                  key={row.kind}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2",
                    row.disabled && "opacity-45",
                  )}
                >
                  <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--text-faint)]" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px]">{row.label}</div>
                    <div className="truncate text-[10px] text-[var(--text-faint)]">
                      {row.hint}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {(["docx", "pdf"] as const).map((format) => (
                      <button
                        key={format}
                        disabled={row.disabled || busy !== null}
                        onClick={() => void download(row.kind, format)}
                        className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--text-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {busy === `${row.kind}:${format}` ? (
                          <Loader2 className="h-2.5 w-2.5 animate-spin" />
                        ) : (
                          format
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {error && (
              <p className="border-t border-[var(--border)] px-3 py-2 text-[11px] text-red-500">
                {error}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function truncate(value: string, max = 22): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
