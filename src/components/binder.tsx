"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronRight, GripVertical, Plus, Trash2 } from "lucide-react";

import type { NodeRoot, NodeType } from "@/db/schema";
import { buildTree, flattenVisible, subtreeWords, type ClientNode, type TreeNode } from "@/lib/api";
import { cn, formatCount } from "@/lib/utils";
import { NodeIcon, StatusDot } from "./node-visuals";

/**
 * The binder: one drag-and-drop tree over all node types.
 *
 * Drag semantics: dropping onto the *row* of a container nests inside it;
 * dropping between rows reorders at that depth. dnd-kit gives us a flat sortable
 * list, so we translate the flat drop index back into (parentId, position) using
 * the visible-order flattening.
 */

export type BinderSectionSpec = {
  root: NodeRoot;
  label: string;
  addTypes: NodeType[];
};

export const SECTIONS: BinderSectionSpec[] = [
  { root: "manuscript", label: "Manuscript", addTypes: ["act", "chapter", "scene", "folder"] },
  { root: "world", label: "World", addTypes: ["character", "location", "lore", "folder"] },
  { root: "planning", label: "Planning", addTypes: ["beat", "note", "folder"] },
];

/**
 * Renders exactly one section's tree. The rail owns which section is active, so
 * a long manuscript can no longer squeeze World and Planning off the screen —
 * each section gets the full height of the column.
 */
export function Binder({
  section,
  nodes,
  selectedId,
  onSelect,
  onCreate,
  onMove,
  onDelete,
}: {
  section: BinderSectionSpec;
  nodes: ClientNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: (input: { parentId: string | null; root: NodeRoot; type: NodeType }) => void;
  onMove: (id: string, parentId: string | null, position: number) => void;
  onDelete: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState<TreeNode | null>(null);

  const sensors = useSensors(
    // A small activation distance keeps plain clicks from starting a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex h-full flex-col">
      <BinderSection
        section={section}
        nodes={nodes}
        collapsed={collapsed}
        setCollapsed={setCollapsed}
        selectedId={selectedId}
        dragging={dragging}
        sensors={sensors}
        onToggle={toggle}
        onSelect={onSelect}
        onCreate={onCreate}
        onMove={onMove}
        onDelete={onDelete}
        setDragging={setDragging}
      />
    </div>
  );
}

function BinderSection({
  section,
  nodes,
  collapsed,
  setCollapsed,
  selectedId,
  dragging,
  sensors,
  onToggle,
  onSelect,
  onCreate,
  onMove,
  onDelete,
  setDragging,
}: {
  section: BinderSectionSpec;
  nodes: ClientNode[];
  collapsed: Set<string>;
  setCollapsed: React.Dispatch<React.SetStateAction<Set<string>>>;
  selectedId: string | null;
  dragging: TreeNode | null;
  sensors: ReturnType<typeof useSensors>;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  onCreate: (input: { parentId: string | null; root: NodeRoot; type: NodeType }) => void;
  onMove: (id: string, parentId: string | null, position: number) => void;
  onDelete: (id: string) => void;
  setDragging: (n: TreeNode | null) => void;
}) {
  const tree = useMemo(
    () =>
      buildTree(
        // Cards live on a beat's canvas, not in the binder — showing them here
        // would flatten a spatial map into a meaningless list.
        nodes.filter((n) => n.root === section.root && n.type !== "card"),
        section.root,
      ),
    [nodes, section.root],
  );
  const visible = useMemo(() => flattenVisible(tree, collapsed), [tree, collapsed]);
  const ids = visible.map((v) => v.node.id);

  const words = tree.reduce((sum, n) => sum + subtreeWords(n), 0);

  function handleDragStart(event: DragStartEvent) {
    const found = visible.find((v) => v.node.id === event.active.id);
    setDragging(found?.node ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setDragging(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const fromIndex = visible.findIndex((v) => v.node.id === active.id);
    const toIndex = visible.findIndex((v) => v.node.id === over.id);
    if (fromIndex < 0 || toIndex < 0) return;

    const target = visible[toIndex];
    const moved = visible[fromIndex].node;

    // Refuse to drop a node into its own subtree — that would orphan the branch.
    if (isWithin(moved, target.node.id)) return;

    /**
     * Where the node lands depends on what it was dropped on.
     *
     * Dropping onto an *open, empty* container nests inside it — that is the
     * only way to get the first child in. Otherwise the node becomes a sibling
     * of the target at the target's own slot, which is what makes reordering
     * work at all: previously every drop onto a container appended to the end,
     * so a chapter could never be moved above another chapter and a scene could
     * not be placed anywhere but last.
     */
    const isContainer = ["folder", "act", "chapter", "beat"].includes(target.node.type);
    const nestInside = isContainer && target.node.children.length === 0;

    const parentId = nestInside ? target.node.id : target.node.parentId;

    const siblings = collectSiblings(tree, parentId).filter((s) => s.id !== moved.id);

    let position: number;
    if (nestInside) {
      position = 0;
    } else {
      const targetIndex = siblings.findIndex((s) => s.id === target.node.id);
      if (targetIndex < 0) {
        position = siblings.length;
      } else {
        // Dragging downward past the target should land *after* it; dragging
        // upward lands before. Without this, a downward drag by one slot is a
        // no-op because the node is removed from earlier in the list.
        position = fromIndex < toIndex ? targetIndex + 1 : targetIndex;
      }
    }

    onMove(moved.id, parentId, position);
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-2 px-3 pb-1 pt-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
          {section.label}
        </h2>
        <span className="ml-auto text-[11px] tabular-nums text-[var(--text-faint)]">
          {words > 0 ? formatCount(words) : ""}
        </span>
        <AddMenu
          types={section.addTypes}
          onPick={(type) => {
            const parentId = chooseParent(type, selectedId, nodes, section.root);
            // Creating into a collapsed folder would otherwise appear to do
            // nothing — the new node exists but is hidden.
            if (parentId) {
              setCollapsed((prev) => {
                if (!prev.has(parentId)) return prev;
                const next = new Set(prev);
                next.delete(parentId);
                return next;
              });
            }
            onCreate({ parentId, root: section.root, type });
          }}
        />
      </header>

      {/**
       * The explicit `id` is load-bearing, not decoration. Without it dnd-kit
       * derives its aria-describedby ids from a module-level counter whose value
       * differs between the server render and the client remount, so every
       * sortable row hydrates with a mismatched attribute. A stable id per
       * section short-circuits that counter (see useUniqueId).
       */}
      <DndContext
        id={`binder-${section.root}`}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul className="min-h-0 flex-1 overflow-y-auto pb-2">
            {visible.map(({ node, depth }) => (
              <BinderRow
                key={node.id}
                node={node}
                depth={depth}
                selected={selectedId === node.id}
                collapsed={collapsed.has(node.id)}
                onToggle={onToggle}
                onSelect={onSelect}
                onDelete={onDelete}
              />
            ))}
            {visible.length === 0 && (
              <li className="px-3 py-2 text-xs italic text-[var(--text-faint)]">
                Nothing here yet.
              </li>
            )}
          </ul>
        </SortableContext>

        <DragOverlay>
          {dragging ? (
            <div className="flex items-center gap-2 rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-2 py-1.5 text-sm shadow-[var(--shadow-pop)]">
              <NodeIcon type={dragging.type} className="h-3.5 w-3.5 text-[var(--text-muted)]" />
              <span className="truncate">{dragging.title}</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </section>
  );
}

function BinderRow({
  node,
  depth,
  selected,
  collapsed,
  onToggle,
  onSelect,
  onDelete,
}: {
  node: TreeNode;
  depth: number;
  selected: boolean;
  collapsed: boolean;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: node.id });

  const hasChildren = node.children.length > 0;
  const words = subtreeWords(node);
  const status = (node.meta as Record<string, unknown>)?.status as string | undefined;

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        paddingLeft: `${depth * 14 + 8}px`,
      }}
      className="group relative pr-2"
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelect(node.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(node.id);
          }
        }}
        className={cn(
          "flex w-full items-center gap-1.5 rounded-md py-[5px] pl-1 pr-1.5 text-left text-[13px] transition-colors",
          "hover:bg-[var(--surface)]",
          selected
            ? "bg-[var(--accent-soft)] text-[var(--text)] ring-1 ring-inset ring-[color-mix(in_srgb,var(--accent)_35%,transparent)]"
            : "text-[var(--text)]",
        )}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) onToggle(node.id);
          }}
          className={cn(
            "grid h-4 w-4 shrink-0 place-items-center rounded text-[var(--text-faint)]",
            hasChildren ? "hover:text-[var(--text)]" : "invisible",
          )}
          aria-label={collapsed ? "Expand" : "Collapse"}
          tabIndex={-1}
        >
          <ChevronRight
            className={cn("h-3 w-3 transition-transform", !collapsed && "rotate-90")}
          />
        </button>

        <NodeIcon
          type={node.type}
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            selected ? "text-[var(--accent)]" : "text-[var(--text-faint)]",
          )}
        />

        <span className="truncate">{node.title}</span>

        {status && <StatusDot status={status} />}

        <span className="ml-auto flex items-center gap-1">
          {words > 0 && (
            <span className="text-[10px] tabular-nums text-[var(--text-faint)] group-hover:hidden">
              {formatCount(words)}
            </span>
          )}
          <span className="hidden items-center gap-0.5 group-hover:flex">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(node.id);
              }}
              className="grid h-5 w-5 place-items-center rounded text-[var(--text-faint)] hover:bg-[var(--surface)] hover:text-red-500"
              aria-label={`Delete ${node.title}`}
            >
              <Trash2 className="h-3 w-3" />
            </button>
            <button
              {...attributes}
              {...listeners}
              onClick={(e) => e.stopPropagation()}
              className="grid h-5 w-5 cursor-grab place-items-center rounded text-[var(--text-faint)] hover:bg-[var(--surface)] hover:text-[var(--text)] active:cursor-grabbing"
              aria-label={`Reorder ${node.title}`}
            >
              <GripVertical className="h-3 w-3" />
            </button>
          </span>
        </span>
      </div>
    </li>
  );
}

function AddMenu({
  types,
  onPick,
}: {
  types: NodeType[];
  onPick: (type: NodeType) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        className="grid h-5 w-5 place-items-center rounded text-[var(--text-faint)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text)]"
        aria-label="Add"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="animate-fade-in absolute right-0 top-6 z-20 w-40 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] py-1 shadow-[var(--shadow-pop)]">
          {types.map((t) => (
            <button
              key={t}
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(t);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] capitalize hover:bg-[var(--surface)]"
            >
              <NodeIcon type={t} className="h-3.5 w-3.5 text-[var(--text-faint)]" />
              New {t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Which type may contain which. A scene belongs in a chapter, a chapter in an
 * act, and world entries in a folder of their own kind.
 */
const CONTAINER_FOR: Partial<Record<NodeType, NodeType[]>> = {
  scene: ["chapter"],
  chapter: ["act", "folder"],
  card: ["beat"],
  character: ["folder"],
  location: ["folder"],
  lore: ["folder"],
  note: ["folder", "chapter", "act"],
  beat: ["folder"],
};

/**
 * Picks the parent a newly created node should go under.
 *
 * The rule reads as "put it where I'm looking": walk up from the current
 * selection until reaching something that can legitimately contain the new
 * type. Creating a scene while a chapter is open puts it in that chapter;
 * creating a character while another character is selected puts it in the same
 * folder, beside its sibling.
 *
 * Falls back to the first suitable folder in the section, and finally to the
 * top level — so a project with no folders still works.
 */
function chooseParent(
  type: NodeType,
  selectedId: string | null,
  nodes: ClientNode[],
  root: NodeRoot,
): string | null {
  const allowed = CONTAINER_FOR[type];
  if (!allowed || allowed.length === 0) return null;

  const live = nodes.filter((n) => n.root === root && !n.deletedAt);
  const byId = new Map(live.map((n) => [n.id, n]));

  /**
   * World entries belong with their own kind, so the conventional folder wins
   * over wherever the selection happens to be. Creating a location while a
   * character is selected must not drop it into Characters.
   */
  const named = preferredFolderName(type);
  if (named) {
    const home = live.find(
      (n) => n.type === "folder" && n.title.toLowerCase().startsWith(named),
    );
    if (home) return home.id;

    // No conventional folder: fall back to a sibling's folder, so entries of
    // the same type at least stay together.
    const sibling = live.find((n) => n.type === type && n.parentId);
    if (sibling?.parentId) return sibling.parentId;
  }

  // Manuscript and planning follow the selection instead: "put it where I am
  // looking" is the right rule for a scene, which belongs to the chapter being
  // worked on rather than to a fixed folder.
  let cursor = selectedId ? byId.get(selectedId) : undefined;
  const guard = new Set<string>();
  while (cursor && !guard.has(cursor.id)) {
    guard.add(cursor.id);
    if (allowed.includes(cursor.type)) return cursor.id;
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }

  const fallback = live
    .filter((n) => allowed.includes(n.type))
    .sort((a, b) => (a.idx < b.idx ? -1 : 1));

  return fallback[0]?.id ?? null;
}

/** The conventional folder each world type belongs in, when one exists. */
function preferredFolderName(type: NodeType): string | null {
  switch (type) {
    case "character":
      return "character";
    case "location":
      return "location";
    case "lore":
      return "lore";
    default:
      return null;
  }
}

/** True if `id` is `node` or lives inside its subtree. */
function isWithin(node: TreeNode, id: string): boolean {
  if (node.id === id) return true;
  return node.children.some((c) => isWithin(c, id));
}

function collectSiblings(tree: TreeNode[], parentId: string | null): TreeNode[] {
  if (parentId === null) return tree;
  const stack = [...tree];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.id === parentId) return n.children;
    stack.push(...n.children);
  }
  return [];
}
