"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";

/**
 * Password recovery by security questions.
 *
 * Two steps: look up the questions for an email, then answer both and set a new
 * password. Succeeding does NOT sign you in — you return to the login screen and
 * use the new password, so guessing the answers alone never yields a session.
 */
export function RecoverForm({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState("");
  const [questions, setQuestions] = useState<{ q1: string; q2: string } | null>(null);
  const [answer1, setAnswer1] = useState("");
  const [answer2, setAnswer2] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/recover", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not find that account.");
        return;
      }
      setQuestions({ q1: data.question1, q2: data.question2 });
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function reset(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/recover", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, answer1, answer2, newPassword: password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not reset the password.");
        return;
      }
      setDone(true);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-5 shadow-[var(--shadow-card)]">
        <p className="flex items-center gap-1.5 text-[13px] text-[var(--status-revised)]">
          <Check className="h-4 w-4" /> Password reset.
        </p>
        <p className="mt-1.5 text-[12px] text-[var(--text-muted)]">
          Sign in with your new password.
        </p>
        <button
          onClick={onBack}
          className="mt-3 w-full rounded-lg px-3 py-2 text-[13px] font-medium text-[var(--accent-contrast)]"
          style={{ background: "var(--accent)" }}
        >
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={questions ? reset : lookup}
      className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-5 shadow-[var(--shadow-card)]"
    >
      <Field label="Email">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={questions !== null}
          required
          autoFocus
          className={inputClass}
        />
      </Field>

      {questions && (
        <>
          <Field label={questions.q1}>
            <input
              value={answer1}
              onChange={(e) => setAnswer1(e.target.value)}
              required
              className={inputClass}
            />
          </Field>
          <Field label={questions.q2}>
            <input
              value={answer2}
              onChange={(e) => setAnswer2(e.target.value)}
              required
              className={inputClass}
            />
          </Field>
          <Field label="New password">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              autoComplete="new-password"
              required
              className={inputClass}
            />
          </Field>
        </>
      )}

      {error && (
        <p
          role="alert"
          className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-2 text-[12px] text-red-600 dark:text-red-400"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium text-[var(--accent-contrast)] disabled:opacity-50"
        style={{ background: "var(--accent)" }}
      >
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {questions ? "Reset password" : "Continue"}
      </button>

      <button
        type="button"
        onClick={onBack}
        className="mt-2 w-full text-[12px] text-[var(--text-muted)] hover:text-[var(--text)]"
      >
        Back to sign in
      </button>
    </form>
  );
}

const inputClass =
  "w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-[13px] text-[var(--text)] focus:border-[var(--accent)] focus:outline-none disabled:opacity-60";

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
