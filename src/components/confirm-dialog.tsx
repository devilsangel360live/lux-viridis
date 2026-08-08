"use client";

import { useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";

/**
 * A modal confirmation for destructive actions.
 *
 * Deliberately not `window.confirm`: that blocks the whole page, cannot say how
 * much is about to disappear, and looks like a browser warning rather than part
 * of the app. Here the writer can see exactly what they are about to lose.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  detail,
  confirmLabel = "Delete",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  /** Extra context, e.g. how many items and words are inside. */
  detail?: string | null;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    // Focus lands on the confirm button so Enter completes the action the user
    // just asked for, and Escape always backs out.
    const t = setTimeout(() => confirmRef.current?.focus(), 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[100] grid place-items-center bg-black/30 px-6"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-fade-in w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-5 shadow-[var(--shadow-pop)]"
      >
        <div className="flex gap-3">
          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-red-500/10 text-red-500">
            <AlertTriangle className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold text-[var(--text)]">{title}</h2>
            <p className="mt-1 text-[12.5px] leading-snug text-[var(--text-muted)]">
              {message}
            </p>
            {detail && (
              <p className="mt-1.5 text-[11px] leading-snug text-[var(--text-faint)]">
                {detail}
              </p>
            )}
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border border-[var(--border)] px-2.5 py-1.5 text-[12.5px] transition-colors hover:bg-[var(--surface)]"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            className="rounded-md bg-red-500 px-2.5 py-1.5 text-[12.5px] font-medium text-white transition-opacity hover:opacity-90"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
