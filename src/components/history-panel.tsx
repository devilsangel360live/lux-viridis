"use client";

import { useCallback, useEffect, useState } from "react";
import { Camera, History, Loader2, RotateCcw } from "lucide-react";

import { cn, formatCount } from "@/lib/utils";

type Snapshot = {
  id: string;
  kind: "auto" | "manual" | "pre-restore";
  label: string | null;
  title: string | null;
  wordCount: number;
  plain: string;
  createdAt: string | number | Date;
};

/**
 * Version history for the selected document.
 *
 * The point is that revising should feel safe: cut a scene in half, and the
 * previous version is still one click away an hour later.
 */
export function HistoryPanel({
  nodeId,
  currentWordCount,
  onRestored,
}: {
  nodeId: string;
  currentWordCount: number;
  onRestored: () => void;
}) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const res = await fetch(`/api/nodes/${nodeId}/snapshots`, {
        cache: "no-store",
        signal,
      });
      const data = await res.json();
      setSnapshots(data.snapshots ?? []);
      setLoading(false);
    },
    [nodeId],
  );

  useEffect(() => {
    // Deferred a tick so the effect body itself performs no state update.
    // The controller cancels the fetch if the panel unmounts first — switching
    // documents quickly would otherwise leave an aborted request in the console.
    const controller = new AbortController();
    const t = setTimeout(() => {
      void load(controller.signal).catch(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    }, 0);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [load]);

  async function takeSnapshot() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch(`/api/nodes/${nodeId}/snapshots`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: null }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function restore(id: string) {
    if (busy) return;
    setBusy(true);
    try {
      await fetch(`/api/snapshots/${id}`, { method: "POST" });
      await load();
      onRestored();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-[var(--border)] pt-4">
      <div className="mb-1.5 flex items-center gap-1.5">
        <History className="h-3 w-3 text-[var(--text-faint)]" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
          History
        </span>
        <button
          onClick={() => void takeSnapshot()}
          disabled={busy}
          className="ml-auto flex items-center gap-1 rounded-md border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text)] disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Camera className="h-2.5 w-2.5" />}
          Save version
        </button>
      </div>

      {loading ? (
        <div className="py-3 text-center">
          <Loader2 className="inline h-3 w-3 animate-spin text-[var(--text-faint)]" />
        </div>
      ) : snapshots.length === 0 ? (
        <p className="py-2 text-[11px] italic leading-snug text-[var(--text-faint)]">
          No saved versions yet. One is kept automatically as this document
          changes.
        </p>
      ) : (
        <ul className="space-y-0.5">
          <li className="flex items-baseline gap-2 rounded-md px-1.5 py-1 text-[11px]">
            <span className="font-medium text-[var(--accent)]">Now</span>
            <span className="ml-auto tabular-nums text-[var(--text-faint)]">
              {formatCount(currentWordCount)}w
            </span>
          </li>

          {snapshots.map((s) => {
            const delta = s.wordCount - currentWordCount;
            return (
              <li key={s.id}>
                <div
                  className="group flex items-baseline gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-[var(--surface-raised)]"
                  onMouseEnter={() => setPreview(s.id)}
                  onMouseLeave={() => setPreview(null)}
                >
                  <span className="text-[11px] text-[var(--text-muted)]">
                    {timeAgo(s.createdAt)}
                  </span>
                  <span
                    className={cn(
                      "rounded px-1 text-[9px] uppercase tracking-wide",
                      s.kind === "manual"
                        ? "text-[var(--accent)]"
                        : "text-[var(--text-faint)]",
                    )}
                  >
                    {s.kind === "pre-restore" ? "pre-restore" : s.kind}
                  </span>

                  <span className="ml-auto flex items-center gap-1">
                    <span className="tabular-nums text-[11px] text-[var(--text-faint)]">
                      {formatCount(s.wordCount)}w
                      {delta !== 0 && (
                        <span className={delta > 0 ? "text-[var(--status-revised)]" : "text-[var(--text-faint)]"}>
                          {" "}
                          {delta > 0 ? "+" : ""}
                          {delta}
                        </span>
                      )}
                    </span>
                    <button
                      onClick={() => void restore(s.id)}
                      disabled={busy}
                      title="Restore this version"
                      aria-label={`Restore version from ${timeAgo(s.createdAt)}`}
                      className="grid h-5 w-5 place-items-center rounded text-[var(--text-faint)] opacity-0 transition-opacity hover:text-[var(--accent)] group-hover:opacity-100"
                    >
                      <RotateCcw className="h-3 w-3" />
                    </button>
                  </span>
                </div>

                {preview === s.id && s.plain && (
                  <p className="mx-1.5 mb-1 line-clamp-3 rounded border border-[var(--border)] bg-[var(--surface-raised)] p-1.5 text-[10px] leading-snug text-[var(--text-muted)]">
                    {s.plain.slice(0, 200)}
                    {s.plain.length > 200 ? "…" : ""}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function timeAgo(value: string | number | Date): string {
  const mins = Math.floor((Date.now() - new Date(value).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
