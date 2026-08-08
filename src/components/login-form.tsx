"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { RECOVERY_QUESTIONS } from "@/lib/recovery";
import { RecoverForm } from "./recover-form";

/**
 * Sign-in, and first-run account creation when no user exists yet.
 *
 * Both live in one component because they are the same form with one extra
 * field — and because a first-run screen that looks nothing like the login
 * screen is disorienting on the second visit.
 */
export function LoginForm({ setup }: { setup: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recovering, setRecovering] = useState(false);
  // Recovery questions, collected during first-run setup only.
  const [q1, setQ1] = useState<string>(RECOVERY_QUESTIONS[0]);
  const [a1, setA1] = useState("");
  const [q2, setQ2] = useState<string>(RECOVERY_QUESTIONS[1]);
  const [a2, setA2] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(setup ? "/api/auth/setup" : "/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          setup
            ? {
                name,
                email,
                password,
                recovery: { question1: q1, answer1: a1, question2: q2, answer2: a2 },
              }
            : { email, password },
        ),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Something went wrong. Try again.");
        return;
      }

      router.push("/");
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[var(--surface)] px-6">
      <div className="w-full max-w-sm">
        <div className="mb-7 text-center">
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-[var(--text)]">
            Lux Viridis
          </h1>
          <p className="mt-1.5 text-[13px] text-[var(--text-muted)]">
            {setup
              ? "Create your account to begin."
              : "A place to write and plan your stories."}
          </p>
        </div>

        {recovering ? (
          <RecoverForm onBack={() => setRecovering(false)} />
        ) : (
        <form
          onSubmit={submit}
          className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-5 shadow-[var(--shadow-card)]"
        >
          {setup && (
            <Field label="Your name">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                required
                className={inputClass}
              />
            </Field>
          )}

          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
              autoFocus={!setup}
              className={inputClass}
            />
          </Field>

          <Field label="Password">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={setup ? "new-password" : "current-password"}
              required
              minLength={setup ? 8 : undefined}
              className={inputClass}
            />
            {setup && (
              <p className="mt-1 text-[11px] text-[var(--text-faint)]">
                At least 8 characters.
              </p>
            )}
          </Field>

          {setup && (
            <div className="mb-3 rounded-md border border-[var(--border)] bg-[var(--surface)] p-2.5">
              <p className="mb-2 text-[11px] leading-snug text-[var(--text-muted)]">
                Two questions in case you ever forget your password. Pick
                answers you will still remember in a year.
              </p>
              <RecoveryPicker
                index={1}
                question={q1}
                answer={a1}
                exclude={q2}
                onQuestion={setQ1}
                onAnswer={setA1}
              />
              <RecoveryPicker
                index={2}
                question={q2}
                answer={a2}
                exclude={q1}
                onQuestion={setQ2}
                onAnswer={setA2}
              />
            </div>
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
            className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium text-[var(--accent-contrast)] transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: "var(--accent)" }}
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {setup ? "Create account" : "Sign in"}
          </button>

          {!setup && (
            <button
              type="button"
              onClick={() => setRecovering(true)}
              className="mt-2.5 w-full text-[12px] text-[var(--text-muted)] hover:text-[var(--text)]"
            >
              Forgot your password?
            </button>
          )}
        </form>
        )}
      </div>
    </main>
  );
}

/** One question/answer pair, excluding whatever the other picker has chosen. */
function RecoveryPicker({
  index,
  question,
  answer,
  exclude,
  onQuestion,
  onAnswer,
}: {
  index: number;
  question: string;
  answer: string;
  exclude: string;
  onQuestion: (q: string) => void;
  onAnswer: (a: string) => void;
}) {
  return (
    <div className="mb-2 last:mb-0">
      <select
        value={question}
        onChange={(e) => onQuestion(e.target.value)}
        className="mb-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-1.5 text-[12px] focus:border-[var(--accent)] focus:outline-none"
      >
        {RECOVERY_QUESTIONS.filter((q) => q === question || q !== exclude).map((q) => (
          <option key={q} value={q}>
            {q}
          </option>
        ))}
      </select>
      <input
        value={answer}
        onChange={(e) => onAnswer(e.target.value)}
        required
        placeholder={`Answer ${index}`}
        className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-1.5 text-[12px] focus:border-[var(--accent)] focus:outline-none"
      />
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
