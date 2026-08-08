"use client";

import { useCallback, useEffect, useState } from "react";
import { CornerUpLeft, Loader2 } from "lucide-react";

import type { ClientNode } from "@/lib/api";
import { NodeIcon } from "./node-visuals";

type Backlink = { node: ClientNode; order: number | null };

/**
 * Everything that mentions this entity, in manuscript reading order.
 *
 * This is the payoff for storing every node in one table: a character sheet and
 * a scene are the same kind of object, so "where does Kaelen appear?" is one
 * query rather than a separate subsystem.
 */
export function BacklinksPanel({
  nodeId,
  onSelect,
}: {
  nodeId: string;
  onSelect: (id: string) => void;
}) {
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const res = await fetch(`/api/nodes/${nodeId}/backlinks`, {
        cache: "no-store",
        signal,
      });
      const data = await res.json();
      setBacklinks(data.backlinks ?? []);
      setLoading(false);
    },
    [nodeId],
  );

  useEffect(() => {
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

  const inManuscript = backlinks.filter((b) => b.order !== null);

  return (
    <div className="border-t border-[var(--border)] pt-4">
      <div className="mb-1.5 flex items-center gap-1.5">
        <CornerUpLeft className="h-3 w-3 text-[var(--text-faint)]" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
          Appears in
        </span>
        {!loading && backlinks.length > 0 && (
          <span className="ml-auto text-[10px] tabular-nums text-[var(--text-faint)]">
            {backlinks.length}
          </span>
        )}
      </div>

      {loading ? (
        <div className="py-3 text-center">
          <Loader2 className="inline h-3 w-3 animate-spin text-[var(--text-faint)]" />
        </div>
      ) : backlinks.length === 0 ? (
        <p className="py-2 text-[11px] italic leading-snug text-[var(--text-faint)]">
          Not mentioned yet. Type{" "}
          <span className="not-italic text-[var(--accent)]">@</span> in a scene to
          link to this.
        </p>
      ) : (
        <>
          <ul className="space-y-0.5">
            {backlinks.map((b) => (
              <li key={b.node.id}>
                <button
                  onClick={() => onSelect(b.node.id)}
                  className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-[var(--surface-raised)]"
                >
                  <NodeIcon
                    type={b.node.type}
                    className="h-3 w-3 shrink-0 text-[var(--text-faint)]"
                  />
                  <span className="truncate text-[11.5px]">{b.node.title}</span>
                </button>
              </li>
            ))}
          </ul>

          {/* First and last appearance are only meaningful in reading order. */}
          {inManuscript.length > 1 && (
            <p className="mt-1.5 px-1.5 text-[10px] leading-snug text-[var(--text-faint)]">
              First: {inManuscript[0].node.title}
              <br />
              Last: {inManuscript[inManuscript.length - 1].node.title}
            </p>
          )}
        </>
      )}
    </div>
  );
}
