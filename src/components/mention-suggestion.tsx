"use client";

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { ReactRenderer } from "@tiptap/react";
import type { SuggestionOptions } from "@tiptap/suggestion";

import { NodeIcon } from "./node-visuals";
import type { NodeType } from "@/db/schema";
import { cn } from "@/lib/utils";

/**
 * The @-mention picker.
 *
 * Candidates are fetched once per editor session and filtered client-side —
 * a world bible is small enough that a round trip per keystroke would be pure
 * latency for no benefit.
 */

export type MentionItem = {
  id: string;
  title: string;
  type: NodeType;
  synopsis: string | null;
};

type ListProps = {
  items: MentionItem[];
  command: (item: { id: string; label: string }) => void;
};

export type ListHandle = {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
};

const MentionList = forwardRef<ListHandle, ListProps>(function MentionList(
  { items, command },
  ref,
) {
  const [index, setIndex] = useState(0);

  // A changed result set invalidates the highlighted row.
  useEffect(() => setIndex(0), [items]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === "ArrowUp") {
        setIndex((i) => (i + items.length - 1) % Math.max(1, items.length));
        return true;
      }
      if (event.key === "ArrowDown") {
        setIndex((i) => (i + 1) % Math.max(1, items.length));
        return true;
      }
      if (event.key === "Enter") {
        const item = items[index];
        if (item) command({ id: item.id, label: item.title });
        return true;
      }
      return false;
    },
  }));

  if (items.length === 0) {
    return (
      <div className="w-56 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-2.5 py-2 text-[12px] italic text-[var(--text-faint)] shadow-[var(--shadow-pop)]">
        No matching characters, places or lore.
      </div>
    );
  }

  return (
    <div className="max-h-64 w-56 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] py-1 shadow-[var(--shadow-pop)]">
      {items.map((item, i) => (
        <button
          key={item.id}
          onMouseDown={(e) => {
            e.preventDefault();
            command({ id: item.id, label: item.title });
          }}
          onMouseEnter={() => setIndex(i)}
          className={cn(
            "flex w-full items-center gap-2 px-2.5 py-1.5 text-left",
            i === index ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--surface)]",
          )}
        >
          <NodeIcon
            type={item.type}
            className={cn(
              "h-3.5 w-3.5 shrink-0",
              i === index ? "text-[var(--accent)]" : "text-[var(--text-faint)]",
            )}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px]">{item.title}</span>
            {item.synopsis && (
              <span className="block truncate text-[10px] text-[var(--text-faint)]">
                {item.synopsis}
              </span>
            )}
          </span>
        </button>
      ))}
    </div>
  );
});

/**
 * Builds the suggestion config. `getItems` is supplied by the editor so the
 * candidate list can be loaded once and reused across keystrokes.
 */
export function createMentionSuggestion(
  getItems: () => MentionItem[],
): Omit<SuggestionOptions<MentionItem>, "editor"> {
  return {
    char: "@",
    // Anchor to the popup we position manually below.
    items: ({ query }) => {
      const q = query.toLowerCase();
      return getItems()
        .filter((item) => item.title.toLowerCase().includes(q))
        .slice(0, 8);
    },

    render: () => {
      let renderer: ReactRenderer<ListHandle, ListProps> | null = null;
      let container: HTMLDivElement | null = null;

      /** Positions the popup under the caret, flipping up near the viewport edge. */
      const place = (rect: DOMRect | null) => {
        if (!container || !rect) return;
        const height = container.offsetHeight || 200;
        const below = rect.bottom + 6;
        const flip = below + height > window.innerHeight;
        container.style.left = `${Math.min(rect.left, window.innerWidth - 240)}px`;
        container.style.top = flip ? `${rect.top - height - 6}px` : `${below}px`;
      };

      return {
        onStart: (props) => {
          renderer = new ReactRenderer(MentionList, {
            props: { items: props.items, command: props.command },
            editor: props.editor,
          });

          container = document.createElement("div");
          container.style.position = "fixed";
          container.style.zIndex = "60";
          container.appendChild(renderer.element);
          document.body.appendChild(container);
          place(props.clientRect?.() ?? null);
        },

        onUpdate: (props) => {
          renderer?.updateProps({ items: props.items, command: props.command });
          place(props.clientRect?.() ?? null);
        },

        onKeyDown: (props) => {
          if (props.event.key === "Escape") {
            container?.remove();
            return true;
          }
          return renderer?.ref?.onKeyDown(props) ?? false;
        },

        onExit: () => {
          container?.remove();
          container = null;
          renderer?.destroy();
          renderer = null;
        },
      };
    },
  };
}
