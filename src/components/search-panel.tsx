"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Search as SearchIcon, X } from "lucide-react";

import type { ClientNode } from "@/lib/api";
import { cn } from "@/lib/utils";
import { NodeIcon } from "./node-visuals";

type Hit = {
  node: ClientNode;
  field: "title" | "synopsis" | "body";
  excerpt: string;
  match: { start: number; length: number };
};

const FIELD_LABEL: Record<Hit["field"], string> = {
  title: "title",
  synopsis: "synopsis",
  body: "text",
};

export function SearchPanel({
  projectId,
  selectedId,
  onSelect,
}: {
  projectId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const trimmed = query.trim();
  const active = trimmed.length >= 2;
  /** Hits belong to the last completed request; hide them once the box is cleared. */
  const visibleHits = active ? hits : [];

  useEffect(() => {
    // Below the minimum length there is nothing to fetch and nothing to clean
    // up. Results are gated on `active` at render time rather than being wiped
    // here, which keeps this effect purely about the request.
    if (!active) return;

    // Debounce so a fast typist doesn't fire a request per keystroke. The
    // AbortController keeps a slow earlier response from overwriting a newer one.
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(trimmed)}&projectId=${encodeURIComponent(projectId)}`,
          { signal: controller.signal },
        );
        const data = await res.json();
        setHits(data.hits ?? []);
        setSearched(true);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setHits([]);
          setSearched(true);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 220);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, active, projectId]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-3 pb-2 pt-3">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
          Search
        </h2>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-faint)]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find in project…"
            className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-raised)] py-1.5 pl-8 pr-7 text-[13px] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded text-[var(--text-faint)] hover:text-[var(--text)]"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        <div className="mt-1.5 h-4 text-[11px] text-[var(--text-faint)]">
          {!active ? (
            trimmed.length === 1 ? (
              "Keep typing…"
            ) : (
              ""
            )
          ) : loading ? (
            <span className="flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Searching…
            </span>
          ) : searched ? (
            `${visibleHits.length} ${visibleHits.length === 1 ? "result" : "results"}`
          ) : (
            ""
          )}
        </div>
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {visibleHits.map((hit) => (
          <li key={`${hit.node.id}-${hit.field}`}>
            <button
              onClick={() => onSelect(hit.node.id)}
              className={cn(
                "mb-1 w-full rounded-md px-2 py-2 text-left transition-colors hover:bg-[var(--surface-raised)]",
                selectedId === hit.node.id &&
                  "bg-[var(--accent-soft)] ring-1 ring-inset ring-[color-mix(in_srgb,var(--accent)_35%,transparent)]",
              )}
            >
              <span className="flex items-center gap-1.5">
                <NodeIcon type={hit.node.type} className="h-3 w-3 shrink-0 text-[var(--text-faint)]" />
                <span className="truncate text-[12px] font-medium">{hit.node.title}</span>
                <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
                  {FIELD_LABEL[hit.field]}
                </span>
              </span>
              <span className="mt-1 block text-[11px] leading-snug text-[var(--text-muted)]">
                <Highlight text={hit.excerpt} match={hit.match} />
              </span>
            </button>
          </li>
        ))}

        {active && searched && visibleHits.length === 0 && !loading && (
          <li className="px-2 py-3 text-center text-xs italic text-[var(--text-faint)]">
            No matches for “{trimmed}”.
          </li>
        )}
        {!active && (
          <li className="px-2 py-3 text-center text-xs italic text-[var(--text-faint)]">
            Search prose, synopses, characters and lore.
          </li>
        )}
      </ul>
    </div>
  );
}

/** Marks the matched span without using dangerouslySetInnerHTML. */
function Highlight({ text, match }: { text: string; match: { start: number; length: number } }) {
  const start = Math.max(0, Math.min(match.start, text.length));
  const end = Math.max(start, Math.min(start + match.length, text.length));
  if (end <= start) return <>{text}</>;

  return (
    <>
      {text.slice(0, start)}
      <mark
        className="rounded-[2px] px-0.5"
        style={{ background: "color-mix(in srgb, var(--accent) 30%, transparent)", color: "inherit" }}
      >
        {text.slice(start, end)}
      </mark>
      {text.slice(end)}
    </>
  );
}
