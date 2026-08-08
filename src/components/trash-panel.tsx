"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RotateCcw, Trash2 } from "lucide-react";

import type { ClientNode } from "@/lib/api";
import { NodeIcon } from "./node-visuals";
import { ConfirmDialog } from "./confirm-dialog";

type TrashEntry = ClientNode & { childCount: number };

/**
 * The trash view. Deleting is recoverable, which is the whole point — a
 * mis-click should never be the end of a scene.
 */
export function TrashPanel({
  projectId,
  onRestored,
}: {
  projectId: string;
  onRestored: () => void;
}) {
  const [entries, setEntries] = useState<TrashEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  /** Entry awaiting permanent-delete confirmation. */
  const [pendingPurge, setPendingPurge] = useState<TrashEntry | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/trash?projectId=${encodeURIComponent(projectId)}`, {
      cache: "no-store",
    });
    const data = await res.json();
    setEntries(data.entries ?? []);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    // Deferred a tick so the effect body itself performs no state update; the
    // rule exists to prevent cascading synchronous renders.
    const t = setTimeout(() => {
      void load().catch(() => setLoading(false));
    }, 0);
    return () => clearTimeout(t);
  }, [load]);

  async function restore(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    await fetch(`/api/trash/${id}`, { method: "POST" }).catch(() => {});
    onRestored();
    void load();
  }

  async function purge(id: string) {
    setPendingPurge(null);
    setEntries((prev) => prev.filter((e) => e.id !== id));
    await fetch(`/api/trash/${id}`, { method: "DELETE" }).catch(() => {});
    void load();
  }

  async function empty() {
    setConfirmEmpty(false);
    setEntries([]);
    await fetch(`/api/trash?projectId=${encodeURIComponent(projectId)}`, {
      method: "DELETE",
    }).catch(() => {});
    void load();
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 px-3 pb-2 pt-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
          Trash
        </h2>
        {entries.length > 0 && (
          <button
            onClick={() => setConfirmEmpty(true)}
            className="ml-auto text-[11px] text-[var(--text-faint)] transition-colors hover:text-red-500"
          >
            Empty
          </button>
        )}
      </header>

      {confirmEmpty && (
        <div className="mx-2 mb-2 shrink-0 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-2.5">
          <p className="text-[11px] leading-snug text-[var(--text-muted)]">
            Permanently delete {entries.length}{" "}
            {entries.length === 1 ? "item" : "items"}? This cannot be undone.
          </p>
          <div className="mt-2 flex gap-1.5">
            <button
              onClick={() => void empty()}
              className="rounded-md bg-red-500 px-2 py-1 text-[11px] font-medium text-white hover:opacity-90"
            >
              Delete forever
            </button>
            <button
              onClick={() => setConfirmEmpty(false)}
              className="rounded-md border border-[var(--border)] px-2 py-1 text-[11px] hover:bg-[var(--surface)]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {loading && (
          <li className="grid place-items-center py-6 text-[var(--text-faint)]">
            <Loader2 className="h-4 w-4 animate-spin" />
          </li>
        )}

        {!loading &&
          entries.map((entry) => (
            <li
              key={entry.id}
              className="group mb-1 rounded-md px-2 py-2 transition-colors hover:bg-[var(--surface-raised)]"
            >
              <div className="flex items-center gap-1.5">
                <NodeIcon
                  type={entry.type}
                  className="h-3 w-3 shrink-0 text-[var(--text-faint)]"
                />
                <span className="truncate text-[12px] font-medium">{entry.title}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-2 pl-[18px]">
                <span className="text-[10px] text-[var(--text-faint)]">
                  {entry.childCount > 0
                    ? `${entry.childCount} item${entry.childCount === 1 ? "" : "s"} inside · `
                    : ""}
                  {entry.deletedAt ? timeAgo(entry.deletedAt) : ""}
                </span>
                <span className="ml-auto hidden items-center gap-1 group-hover:flex">
                  <button
                    onClick={() => void restore(entry.id)}
                    title="Restore"
                    aria-label={`Restore ${entry.title}`}
                    className="grid h-5 w-5 place-items-center rounded text-[var(--text-faint)] hover:bg-[var(--surface)] hover:text-[var(--status-revised)]"
                  >
                    <RotateCcw className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => setPendingPurge(entry)}
                    title="Delete forever"
                    aria-label={`Permanently delete ${entry.title}`}
                    className="grid h-5 w-5 place-items-center rounded text-[var(--text-faint)] hover:bg-[var(--surface)] hover:text-red-500"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </span>
              </div>
            </li>
          ))}

        {!loading && entries.length === 0 && (
          <li className="px-2 py-6 text-center text-xs italic leading-relaxed text-[var(--text-faint)]">
            Nothing deleted. Anything you remove lands here first, so you can
            always change your mind.
          </li>
        )}
      </ul>

      <ConfirmDialog
        open={pendingPurge !== null}
        title={`Permanently delete “${pendingPurge?.title ?? ""}”?`}
        message="This cannot be undone. It will not be recoverable."
        detail={
          pendingPurge && pendingPurge.childCount > 0
            ? `${pendingPurge.childCount} item${pendingPurge.childCount === 1 ? "" : "s"} inside will go too`
            : null
        }
        confirmLabel="Delete forever"
        onConfirm={() => pendingPurge && void purge(pendingPurge.id)}
        onCancel={() => setPendingPurge(null)}
      />
    </div>
  );
}

function timeAgo(value: string | number | Date): string {
  const then = new Date(value).getTime();
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
