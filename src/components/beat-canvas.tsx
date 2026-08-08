"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Maximize2, Plus, Trash2 } from "lucide-react";

import type { ClientNode } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "./confirm-dialog";

/**
 * The beat mind-map canvas.
 *
 * Cards are absolutely positioned in an unscaled "world" coordinate space; the
 * whole world is then translated and scaled by a single transform. Keeping card
 * coordinates independent of zoom is what stops positions from drifting as you
 * zoom in and out — screen position is derived, never stored.
 */

const CARD_W = 190;
const CARD_MIN_H = 62;
const GRID = 10;

type Card = ClientNode & { x: number; y: number };
type Edge = {
  id: string;
  sourceId: string;
  targetId: string;
  label: string | null;
};

type Draft = { sourceId: string; x: number; y: number } | null;

export function BeatCanvas({ beat }: { beat: ClientNode }) {
  const [cards, setCards] = useState<Card[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const [dragId, setDragId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  /** Mirrors panStart as state so the pointer-listener effect re-runs. */
  const [panning, setPanning] = useState(false);
  /** Card awaiting delete confirmation. Cards are not recoverable from Trash. */
  const [pendingCard, setPendingCard] = useState<Card | null>(null);

  const surfaceRef = useRef<HTMLDivElement>(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const panStart = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  useEffect(() => {
    // `loading` starts true and is only ever cleared, so the effect body itself
    // performs no synchronous state update — it just kicks off the fetch.
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/beats/${beat.id}/canvas`, { cache: "no-store" });
      const data = await res.json();
      if (cancelled) return;
      setCards(data.cards ?? []);
      setEdges(data.edges ?? []);
      setLoading(false);
    })().catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [beat.id]);

  /** Screen point -> world point, undoing pan and zoom. */
  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = surfaceRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left - view.x) / view.scale,
        y: (clientY - rect.top - view.y) / view.scale,
      };
    },
    [view],
  );

  const addCard = useCallback(
    async (worldX: number, worldY: number) => {
      const res = await fetch(`/api/beats/${beat.id}/canvas`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ x: worldX, y: worldY, title: "New card" }),
      });
      const { card } = await res.json();
      if (card) {
        setCards((prev) => [...prev, card]);
        setEditingId(card.id);
      }
    },
    [beat.id],
  );

  const persistPosition = useCallback(async (id: string, x: number, y: number) => {
    await fetch(`/api/cards/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ x, y }),
    }).catch(() => {});
  }, []);

  const saveTitle = useCallback(async (id: string, title: string) => {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
    await fetch(`/api/cards/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    }).catch(() => {});
  }, []);

  const removeCard = useCallback(async (id: string) => {
    setCards((prev) => prev.filter((c) => c.id !== id));
    setEdges((prev) => prev.filter((e) => e.sourceId !== id && e.targetId !== id));
    await fetch(`/api/cards/${id}`, { method: "DELETE" }).catch(() => {});
  }, []);

  const connect = useCallback(async (sourceId: string, targetId: string) => {
    const res = await fetch("/api/edges", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceId, targetId }),
    });
    if (!res.ok) return;
    const { edge } = await res.json();
    // The server returns the existing row for a duplicate, so de-dupe on id.
    if (edge) setEdges((prev) => (prev.some((e) => e.id === edge.id) ? prev : [...prev, edge]));
  }, []);

  const removeEdge = useCallback(async (id: string) => {
    setEdges((prev) => prev.filter((e) => e.id !== id));
    setSelectedEdge(null);
    await fetch(`/api/edges/${id}`, { method: "DELETE" }).catch(() => {});
  }, []);

  // ------------------------------------------------------------- interaction

  useEffect(() => {
    // `panning` is state, not the ref: the effect must re-run when a pan
    // starts. Reading panStart.current here instead would never re-trigger it,
    // so the move/up listeners were only attached if a card drag was already
    // in progress.
    if (!dragId && !draft && !panning) return;

    const onMove = (e: PointerEvent) => {
      // Read the ref ONCE into a local. The state updater below runs
      // asynchronously, and a pointerup in between would null the ref out from
      // under it — dereferencing it inside the updater crashes the canvas.
      const pan = panStart.current;
      if (pan) {
        setView((v) => ({
          ...v,
          x: pan.vx + (e.clientX - pan.x),
          y: pan.vy + (e.clientY - pan.y),
        }));
        return;
      }
      const world = toWorld(e.clientX, e.clientY);
      if (dragId) {
        const x = Math.round((world.x - dragOffset.current.x) / GRID) * GRID;
        const y = Math.round((world.y - dragOffset.current.y) / GRID) * GRID;
        setCards((prev) => prev.map((c) => (c.id === dragId ? { ...c, x, y } : c)));
      } else if (draft) {
        setDraft({ ...draft, x: world.x, y: world.y });
      }
    };

    const onUp = (e: PointerEvent) => {
      if (panStart.current) {
        panStart.current = null;
        setPanning(false);
        return;
      }
      if (dragId) {
        const card = cards.find((c) => c.id === dragId);
        if (card) void persistPosition(card.id, card.x, card.y);
        setDragId(null);
      }
      if (draft) {
        // Resolve the drop target from the element under the pointer rather than
        // hit-testing rectangles ourselves — it respects z-order for free.
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const targetId = el?.closest("[data-card-id]")?.getAttribute("data-card-id");
        if (targetId && targetId !== draft.sourceId) void connect(draft.sourceId, targetId);
        setDraft(null);
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    // pointercancel fires when the browser takes over the gesture (touch
    // scrolling, a dragged-out window); without it the pan would stick on.
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragId, draft, panning, cards, toWorld, persistPosition, connect]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selectedEdge) {
        // Don't steal Backspace while a card's text is being edited.
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        e.preventDefault();
        void removeEdge(selectedEdge);
      }
      if (e.key === "Escape") {
        setDraft(null);
        setSelectedEdge(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedEdge, removeEdge]);

  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) {
      setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      return;
    }
    // Zoom toward the cursor: keep the world point under the pointer fixed.
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    setView((v) => {
      const scale = Math.min(2, Math.max(0.4, v.scale * (e.deltaY < 0 ? 1.1 : 0.9)));
      const k = scale / v.scale;
      return { scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
    });
  };

  return (
    <div className="relative flex h-full flex-col bg-[var(--canvas)]">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-4 py-2">
        <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--text-faint)]">
          Beat canvas
        </span>
        <span className="text-[11px] text-[var(--text-faint)]">
          {cards.length} {cards.length === 1 ? "card" : "cards"} · {edges.length}{" "}
          {edges.length === 1 ? "link" : "links"}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => setView({ x: 0, y: 0, scale: 1 })}
            className="flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text)]"
          >
            <Maximize2 className="h-3 w-3" /> Reset view
          </button>
          <button
            onClick={() => addCard(80 - view.x / view.scale + 40, 80 - view.y / view.scale + 40)}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-[var(--accent-contrast)] transition-opacity hover:opacity-90"
            style={{ background: "var(--accent)" }}
          >
            <Plus className="h-3 w-3" /> Add card
          </button>
        </div>
      </div>

      <div
        ref={surfaceRef}
        onWheel={onWheel}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest("[data-card-id]")) return;
          const w = toWorld(e.clientX, e.clientY);
          void addCard(w.x - CARD_W / 2, w.y - CARD_MIN_H / 2);
        }}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("[data-card-id]")) return;
          setSelectedEdge(null);
          panStart.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
          setPanning(true);
        }}
        className="relative min-h-0 flex-1 cursor-grab overflow-hidden active:cursor-grabbing"
        style={{
          backgroundImage:
            "radial-gradient(circle, color-mix(in srgb, var(--text-faint) 26%, transparent) 1px, transparent 1px)",
          backgroundSize: `${GRID * 2 * view.scale}px ${GRID * 2 * view.scale}px`,
          backgroundPosition: `${view.x}px ${view.y}px`,
        }}
      >
        {loading && (
          <div className="absolute inset-0 grid place-items-center text-[var(--text-faint)]">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        )}

        {!loading && cards.length === 0 && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <p className="max-w-xs text-center text-sm italic leading-relaxed text-[var(--text-faint)]">
              Double-click anywhere to add your first card, then drag from a card&rsquo;s right
              edge to connect it to another.
            </p>
          </div>
        )}

        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          }}
        >
          <Wires
            cards={cards}
            edges={edges}
            draft={draft}
            selectedEdge={selectedEdge}
            onSelectEdge={setSelectedEdge}
            onDeleteEdge={removeEdge}
          />

          {cards.map((card) => (
            <CardBox
              key={card.id}
              card={card}
              editing={editingId === card.id}
              dragging={dragId === card.id}
              onStartDrag={(e) => {
                const w = toWorld(e.clientX, e.clientY);
                dragOffset.current = { x: w.x - card.x, y: w.y - card.y };
                setDragId(card.id);
                setSelectedEdge(null);
              }}
              onStartConnect={(e) => {
                const w = toWorld(e.clientX, e.clientY);
                setDraft({ sourceId: card.id, x: w.x, y: w.y });
              }}
              onEdit={() => setEditingId(card.id)}
              onCommit={(title) => {
                setEditingId(null);
                if (title !== card.title) void saveTitle(card.id, title);
              }}
              onDelete={() => setPendingCard(card)}
            />
          ))}
        </div>
      </div>

      <ConfirmDialog
        open={pendingCard !== null}
        title="Delete this card?"
        message={
          pendingCard
            ? `“${pendingCard.title}” and any links to it will be removed.`
            : ""
        }
        onConfirm={() => {
          if (pendingCard) void removeCard(pendingCard.id);
          setPendingCard(null);
        }}
        onCancel={() => setPendingCard(null)}
      />

      <p className="shrink-0 border-t border-[var(--border)] px-4 py-1.5 text-[11px] text-[var(--text-faint)]">
        Double-click to add · drag the right edge to connect · click a link then Delete to remove ·
        ⌘/Ctrl+scroll to zoom
      </p>
    </div>
  );
}

/**
 * Defined at module scope on purpose: a component declared inside another is a
 * fresh type on every render, so React would unmount and remount the entire SVG
 * — losing the in-progress draft wire — on each pointer move.
 */
function Wires({
  cards,
  edges,
  draft,
  selectedEdge,
  onSelectEdge,
  onDeleteEdge,
}: {
  cards: Card[];
  edges: Edge[];
  draft: Draft;
  selectedEdge: string | null;
  onSelectEdge: (id: string | null) => void;
  onDeleteEdge: (id: string) => void;
}) {
  const cardById = (id: string) => cards.find((c) => c.id === id);

  // The SVG spans a large fixed area and sits behind the cards; overflow is
  // visible so wires aren't clipped when cards are dragged outside it.
  return (
      <svg
        className="pointer-events-none absolute left-0 top-0 overflow-visible"
        width={4000}
        height={3000}
      >
        <defs>
          <marker
            id="vl-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--border-strong)" />
          </marker>
          <marker
            id="vl-arrow-active"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent)" />
          </marker>
        </defs>

        {edges.map((edge) => {
          const a = cardById(edge.sourceId);
          const b = cardById(edge.targetId);
          if (!a || !b) return null;
          const active = selectedEdge === edge.id;
          const path = wirePath(a, b);
          return (
            <g key={edge.id}>
              {/* Invisible fat stroke makes a 2px wire realistically clickable. */}
              <path
                d={path}
                stroke="transparent"
                strokeWidth={14}
                fill="none"
                className="pointer-events-auto cursor-pointer"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onSelectEdge(edge.id);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  onDeleteEdge(edge.id);
                }}
              />
              <path
                d={path}
                stroke={active ? "var(--accent)" : "var(--border-strong)"}
                strokeWidth={active ? 2.5 : 1.75}
                fill="none"
                markerEnd={`url(#${active ? "vl-arrow-active" : "vl-arrow"})`}
              />
            </g>
          );
        })}

        {draft && cardById(draft.sourceId) && (
          <path
            d={wirePath(cardById(draft.sourceId)!, {
              x: draft.x - CARD_W / 2,
              y: draft.y - CARD_MIN_H / 2,
            })}
            stroke="var(--accent)"
            strokeWidth={2}
            strokeDasharray="5 4"
            fill="none"
            markerEnd="url(#vl-arrow-active)"
          />
        )}
      </svg>
  );
}

function CardBox({
  card,
  editing,
  dragging,
  onStartDrag,
  onStartConnect,
  onEdit,
  onCommit,
  onDelete,
}: {
  card: Card;
  editing: boolean;
  dragging: boolean;
  onStartDrag: (e: React.PointerEvent) => void;
  onStartConnect: (e: React.PointerEvent) => void;
  onEdit: () => void;
  onCommit: (title: string) => void;
  onDelete: () => void;
}) {

  return (
    <div
      data-card-id={card.id}
      style={{ left: card.x, top: card.y, width: CARD_W, minHeight: CARD_MIN_H }}
      className={cn(
        "group absolute rounded-lg border bg-[var(--surface-raised)] shadow-[var(--shadow-card)] transition-shadow",
        dragging
          ? "border-[var(--accent)] shadow-[var(--shadow-pop)]"
          : "border-[var(--border)] hover:border-[var(--border-strong)]",
      )}
    >
      <div
        onPointerDown={(e) => {
          if (editing) return;
          e.stopPropagation();
          onStartDrag(e);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
        className={cn("px-2.5 py-2", editing ? "cursor-text" : "cursor-grab active:cursor-grabbing")}
      >
        {editing ? (
          <CardEditor initial={card.title} onCommit={onCommit} />
        ) : (
          <p className="whitespace-pre-wrap break-words text-[12.5px] leading-snug text-[var(--text)]">
            {card.title}
          </p>
        )}
      </div>

      <button
        onPointerDown={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        aria-label={`Delete card ${card.title}`}
        className="absolute -right-2 -top-2 hidden h-5 w-5 place-items-center rounded-full border border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text-faint)] shadow-sm hover:text-red-500 group-hover:grid"
      >
        <Trash2 className="h-2.5 w-2.5" />
      </button>

      {/* Connection handle. Dragging from here starts a wire. */}
      <button
        onPointerDown={(e) => {
          e.stopPropagation();
          onStartConnect(e);
        }}
        aria-label={`Connect from ${card.title}`}
        className="absolute -right-[7px] top-1/2 h-3.5 w-3.5 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-[var(--canvas)] opacity-0 transition-opacity group-hover:opacity-100"
        style={{ background: "var(--accent)" }}
      />
    </div>
  );
}

/**
 * Owns the text buffer for one editing session. It mounts when editing starts,
 * so `useState(initial)` seeds it exactly once — no prop-to-state syncing, and
 * nothing can clobber what is being typed.
 */
function CardEditor({
  initial,
  onCommit,
}: {
  initial: string;
  onCommit: (title: string) => void;
}) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <textarea
      ref={ref}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onCommit(text.trim() || "Untitled")}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          onCommit(text.trim() || "Untitled");
        }
        if (e.key === "Escape") onCommit(initial);
      }}
      rows={2}
      className="w-full resize-none bg-transparent text-[12.5px] leading-snug text-[var(--text)] focus:outline-none"
    />
  );
}

/**
 * Cubic bezier between two cards.
 *
 * Anchors are chosen per pair: normally right-edge to left-edge, but when the
 * target sits to the LEFT of the source the wire leaves the source's left edge
 * and enters the target's right edge instead. Without that flip the control
 * points swing outward past both cards and the wire reads as detached.
 */
function wirePath(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const backward = b.x + CARD_W < a.x + CARD_W / 2;

  const x1 = backward ? a.x : a.x + CARD_W;
  const x2 = backward ? b.x + CARD_W : b.x;
  const y1 = a.y + CARD_MIN_H / 2;
  const y2 = b.y + CARD_MIN_H / 2;

  const dx = Math.max(40, Math.abs(x2 - x1) * 0.5);
  const c1 = backward ? x1 - dx : x1 + dx;
  const c2 = backward ? x2 + dx : x2 - dx;

  return `M ${x1} ${y1} C ${c1} ${y1}, ${c2} ${y2}, ${x2} ${y2}`;
}
