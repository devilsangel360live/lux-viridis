"use client";

import { useEffect, useRef, useState } from "react";
import { Check, KeyRound, Loader2 } from "lucide-react";

/** Change-password form, shown from the account menu. */
export function PasswordDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => firstRef.current?.focus(), 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;

    // Checked here as well as on the server so the mismatch is caught before a
    // round trip, which is where the user expects to see it.
    if (next !== confirm) {
      setError("The two new passwords don't match.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Could not change the password.");
        return;
      }
      setDone(true);
      setCurrent("");
      setNext("");
      setConfirm("");
      setTimeout(onClose, 1400);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Change password"
      className="fixed inset-0 z-[100] grid place-items-center bg-black/30 px-6"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="animate-fade-in w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-5 shadow-[var(--shadow-pop)]"
      >
        <div className="mb-3 flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-[var(--text-faint)]" />
          <h2 className="text-[14px] font-semibold">Change password</h2>
        </div>

        {done ? (
          <p className="flex items-center gap-1.5 py-2 text-[13px] text-[var(--status-revised)]">
            <Check className="h-3.5 w-3.5" /> Password updated.
          </p>
        ) : (
          <>
            <Field label="Current password">
              <input
                ref={firstRef}
                type="password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                autoComplete="current-password"
                required
                className={inputClass}
              />
            </Field>
            <Field label="New password">
              <input
                type="password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
                className={inputClass}
              />
              <p className="mt-1 text-[11px] text-[var(--text-faint)]">
                At least 8 characters.
              </p>
            </Field>
            <Field label="Confirm new password">
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
                className={inputClass}
              />
            </Field>

            {error && (
              <p
                role="alert"
                className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-2 text-[12px] text-red-600 dark:text-red-400"
              >
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-[var(--border)] px-2.5 py-1.5 text-[12.5px] hover:bg-[var(--surface)]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] font-medium text-[var(--accent-contrast)] disabled:opacity-50"
                style={{ background: "var(--accent)" }}
              >
                {busy && <Loader2 className="h-3 w-3 animate-spin" />}
                Update
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-[13px] text-[var(--text)] focus:border-[var(--accent)] focus:outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
        {label}
      </span>
      {children}
    </label>
  );
}
