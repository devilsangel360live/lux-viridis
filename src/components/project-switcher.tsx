"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, Loader2, Plus } from "lucide-react";

import type { Project } from "@/db/schema";
import { cn, formatCount } from "@/lib/utils";

export type ProjectSummary = Project & {
  manuscriptWords: number;
  nodeCount: number;
};

/**
 * Switches the active project. Navigation is a full page load with `?project=`
 * rather than client-side state, so every server query re-runs scoped to the
 * new project and nothing can linger from the previous one.
 */
export function ProjectSwitcher({
  current,
  projects,
}: {
  current: Project;
  projects: ProjectSummary[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: title.trim() }),
      });
      const { project } = await res.json();
      if (project) {
        router.push(`/?project=${project.id}`);
        // The page is a server component keyed on the search param; refresh
        // re-runs its queries so the new project's tree actually loads.
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors hover:bg-[var(--surface)]"
      >
        <span className="truncate font-serif text-[15px] font-semibold tracking-tight">
          {current.title}
        </span>
        <ChevronsUpDown className="h-3 w-3 shrink-0 text-[var(--text-faint)]" />
      </button>

      {open && (
        <>
          {/* Click-away layer; keeps the menu open while interacting inside it. */}
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="animate-fade-in absolute left-0 top-8 z-40 w-72 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] shadow-[var(--shadow-pop)]">
            <div className="max-h-72 overflow-y-auto py-1">
              {projects.map((p) => (
                <Link
                  key={p.id}
                  href={`/?project=${p.id}`}
                  onClick={() => setOpen(false)}
                  className="flex items-start gap-2 px-2.5 py-2 text-left transition-colors hover:bg-[var(--surface)]"
                >
                  <Check
                    className={cn(
                      "mt-0.5 h-3.5 w-3.5 shrink-0",
                      p.id === current.id
                        ? "text-[var(--accent)]"
                        : "invisible",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{p.title}</span>
                    <span className="block text-[11px] text-[var(--text-faint)]">
                      {formatCount(p.manuscriptWords)} words
                      {p.subtitle ? ` · ${p.subtitle}` : ""}
                    </span>
                  </span>
                </Link>
              ))}
            </div>

            <div className="border-t border-[var(--border)] p-2">
              {creating ? (
                <div className="flex items-center gap-1.5">
                  <input
                    autoFocus
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void create();
                      if (e.key === "Escape") {
                        setCreating(false);
                        setTitle("");
                      }
                    }}
                    placeholder="New story title…"
                    className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[12px] focus:border-[var(--accent)] focus:outline-none"
                  />
                  <button
                    onClick={() => void create()}
                    disabled={busy || !title.trim()}
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-[var(--accent-contrast)] disabled:opacity-40"
                    style={{ background: "var(--accent)" }}
                    aria-label="Create project"
                  >
                    {busy ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Check className="h-3 w-3" />
                    )}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setCreating(true)}
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-[12px] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text)]"
                >
                  <Plus className="h-3.5 w-3.5" /> New story
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
