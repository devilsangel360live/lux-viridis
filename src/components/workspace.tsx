"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlignCenter,
  Check,
  CloudOff,
  KeyRound,
  Loader2,
  LogOut,
  Moon,
  PanelLeft,
  PanelRight,
  Sun,
} from "lucide-react";

import type { NodeRoot, NodeType, Project } from "@/db/schema";
import {
  buildTree,
  createNode as createNodeReq,
  deleteNodeRequest,
  fetchWorkspace,
  moveNodeRequest,
  patchNode,
  subtreeWords,
  type ClientNode,
  type TreeNode,
} from "@/lib/api";
import {
  estimatedPages,
  manuscriptWords as manuscriptSubtreeWords,
  projectStats,
} from "@/lib/stats";
import { cn, formatCount } from "@/lib/utils";
import { Binder, SECTIONS } from "./binder";
import { Editor, type SaveState } from "./editor";
import { Inspector } from "./inspector";
import { Rail, type RailMode } from "./rail";
import { SearchPanel } from "./search-panel";
import { BeatCanvas } from "./beat-canvas";
import { ProjectSwitcher, type ProjectSummary } from "./project-switcher";
import { TrashPanel } from "./trash-panel";
import { ExportMenu } from "./export-menu";
import { TypeMenu } from "./type-menu";
import { ConfirmDialog } from "./confirm-dialog";
import { PasswordDialog } from "./password-dialog";
import {
  DEFAULT_TYPE,
  loadTypeSettings,
  saveTypeSettings,
  type TypeSettings,
} from "@/lib/fonts";

export type SessionUser = { id: string; name: string; email: string };

export function Workspace({
  initialProject,
  initialNodes,
  projects,
  user,
}: {
  initialProject: Project;
  initialNodes: ClientNode[];
  projects: ProjectSummary[];
  user: SessionUser;
}) {
  const [nodes, setNodes] = useState<ClientNode[]>(initialNodes);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialNodes.find((n) => n.type === "scene")?.id ?? initialNodes[0]?.id ?? null,
  );
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [railMode, setRailMode] = useState<RailMode>("manuscript");
  const [showBinder, setShowBinder] = useState(true);
  const [showInspector, setShowInspector] = useState(true);
  const [typewriter, setTypewriter] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  /** Bumped when a restore replaces the open document's text out from under it. */
  const [docVersion, setDocVersion] = useState(0);
  const [typeOpen, setTypeOpen] = useState(false);
  /** The node awaiting delete confirmation, if any. */
  const [pendingDelete, setPendingDelete] = useState<ClientNode | null>(null);
  /**
   * Starts at the default and is replaced from localStorage after mount —
   * reading storage during render would not match the server-rendered HTML.
   */
  const [type, setType] = useState<TypeSettings>(DEFAULT_TYPE);

  useEffect(() => {
    // Deferred a tick so the effect body performs no synchronous state update.
    const t = setTimeout(() => {
      setType(loadTypeSettings());
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const updateType = useCallback((next: TypeSettings) => {
    setType(next);
    saveTypeSettings(next);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const selected = useMemo(
    () => nodes.find((n) => n.id === selectedId) ?? null,
    [nodes, selectedId],
  );

  const tree = useMemo(() => buildTree(nodes), [nodes]);

  /** The whole project's rollups, recomputed as nodes change. */
  const stats = useMemo(() => projectStats(nodes, tree), [nodes, tree]);

  /** The selected node's subtree node, for per-node rollups. */
  const selectedTreeNode = useMemo(() => {
    if (!selected) return null;
    const find = (list: TreeNode[]): TreeNode | null => {
      for (const n of list) {
        if (n.id === selected.id) return n;
        const inner = find(n.children);
        if (inner) return inner;
      }
      return null;
    };
    return find(tree);
  }, [tree, selected]);

  /**
   * Words for the selected node and everything beneath it. Manuscript nodes
   * count prose only; world and planning entries report their own totals, since
   * for those the "notes" figure is the meaningful one.
   */
  const selectedWords = useMemo(() => {
    if (!selected) return 0;
    if (!selectedTreeNode) return selected.wordCount;
    return selected.root === "manuscript"
      ? manuscriptSubtreeWords(selectedTreeNode)
      : subtreeWords(selectedTreeNode);
  }, [selected, selectedTreeNode]);

  /** What a container's total is made of — chapters in an act, scenes in a chapter. */
  const breakdown = useMemo(() => {
    if (!selectedTreeNode) return null;
    const kids = selectedTreeNode.children.filter((c) => c.type !== "card");
    if (kids.length === 0) return null;

    const label =
      selectedTreeNode.type === "act"
        ? "chapter"
        : selectedTreeNode.type === "chapter"
          ? "scene"
          : "item";
    return { count: kids.length, label };
  }, [selectedTreeNode]);

  /**
   * Sequence number for workspace reloads. Several handlers fire `refresh()`
   * without awaiting it, so a slow earlier response could otherwise land after
   * a newer one and resurrect deleted nodes or drop newly created ones.
   */
  const refreshSeq = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++refreshSeq.current;
    const data = await fetchWorkspace(initialProject.id);
    if (seq !== refreshSeq.current) return; // superseded
    setNodes(data.nodes);
  }, [initialProject.id]);

  /** After a restore the open document's text changed server-side: reload and remount. */
  const handleRestored = useCallback(async () => {
    await refresh();
    setDocVersion((v) => v + 1);
  }, [refresh]);

  /**
   * Clicking the active icon collapses the tree column; clicking a different one
   * switches to it and reopens if it was collapsed.
   */
  const handleRailSelect = useCallback(
    (mode: RailMode) => {
      if (mode === railMode) {
        setShowBinder((open) => !open);
        return;
      }
      setRailMode(mode);
      setShowBinder(true);
    },
    [railMode],
  );

  /**
   * Opens a node and reveals it in its own section — used by search hits,
   * backlinks, and clicking an @mention in the prose.
   */
  const handleNavigate = useCallback(
    (id: string) => {
      setSelectedId(id);
      const node = nodes.find((n) => n.id === id);
      if (node && node.root !== "trash") setRailMode(node.root as RailMode);
    },
    [nodes],
  );

  const saveBody = useCallback(async (id: string, body: unknown) => {
    const { node } = await patchNode(id, { body });
    // Replace with the server's row so wordCount/plain stay authoritative.
    setNodes((prev) => prev.map((n) => (n.id === id ? node : n)));
  }, []);

  const handlePatch = useCallback(
    async (id: string, patch: { synopsis?: string; meta?: Record<string, unknown>; title?: string }) => {
      // Optimistic: metadata edits should feel instant.
      setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));
      try {
        const { node } = await patchNode(id, patch);
        setNodes((prev) => prev.map((n) => (n.id === id ? node : n)));
      } catch {
        void refresh();
      }
    },
    [refresh],
  );

  const handleCreate = useCallback(
    async (input: { parentId: string | null; root: NodeRoot; type: NodeType }) => {
      const { node } = await createNodeReq({ ...input, projectId: initialProject.id });
      // Replace-or-append rather than a blind append: an in-flight refresh may
      // already have delivered this node, and appending again would put two
      // rows with the same id into state.
      setNodes((prev) =>
        prev.some((n) => n.id === node.id)
          ? prev.map((n) => (n.id === node.id ? node : n))
          : [...prev, node],
      );
      setSelectedId(node.id);
    },
    [initialProject.id],
  );

  const handleMove = useCallback(
    async (id: string, parentId: string | null, position: number) => {
      try {
        const { node } = await moveNodeRequest(id, { parentId, position });
        setNodes((prev) => prev.map((n) => (n.id === id ? node : n)));
      } catch {
        // A rejected move (e.g. into own subtree) leaves the server unchanged;
        // resync so the UI can't drift from it.
        void refresh();
      }
    },
    [refresh],
  );

  /** Deleting always asks first — see confirmDelete for the actual removal. */
  const handleDelete = useCallback(
    (id: string) => {
      const node = nodes.find((n) => n.id === id);
      if (node) setPendingDelete(node);
    },
    [nodes],
  );

  const confirmDelete = useCallback(async () => {
    const node = pendingDelete;
    setPendingDelete(null);
    if (!node) return;

    await deleteNodeRequest(node.id);
    if (selectedId === node.id) setSelectedId(null);
    // Awaited: a create issued straight after a delete must not race the
    // reload this triggers.
    await refresh();
  }, [pendingDelete, selectedId, refresh]);

  return (
    <div className="flex h-screen flex-col bg-[var(--surface)]">
      <TopBar
        project={initialProject}
        projects={projects}
        user={user}
        selected={selected}
        type={type}
        typeOpen={typeOpen}
        onTypeChange={updateType}
        onToggleType={() => setTypeOpen((v) => !v)}
        saveState={saveState}
        stats={stats}
        showBinder={showBinder}
        showInspector={showInspector}
        typewriter={typewriter}
        theme={theme}
        onToggleBinder={() => setShowBinder((v) => !v)}
        onToggleInspector={() => setShowInspector((v) => !v)}
        onToggleTypewriter={() => setTypewriter((v) => !v)}
        onToggleTheme={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
      />

      <div className="flex min-h-0 flex-1">
        <Rail mode={railMode} open={showBinder} onSelect={handleRailSelect} />

        {showBinder && (
          <div className="flex w-60 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)]">
            {railMode === "search" ? (
              <SearchPanel
                projectId={initialProject.id}
                selectedId={selectedId}
                onSelect={handleNavigate}
              />
            ) : railMode === "trash" ? (
              <TrashPanel projectId={initialProject.id} onRestored={handleRestored} />
            ) : (
              <Binder
                section={SECTIONS.find((s) => s.root === railMode) ?? SECTIONS[0]}
                nodes={nodes}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onCreate={handleCreate}
                onMove={handleMove}
                onDelete={handleDelete}
              />
            )}
          </div>
        )}

        <main className="flex min-w-0 flex-1 flex-col bg-[var(--canvas)]">
          {selected ? (
            <>
              <div className="border-b border-[var(--border)] px-6 py-3 sm:px-10">
                <input
                  value={selected.title}
                  onChange={(e) => handlePatch(selected.id, { title: e.target.value })}
                  className="w-full bg-transparent font-serif text-2xl font-semibold tracking-tight text-[var(--text)] focus:outline-none"
                  placeholder="Untitled"
                />
              </div>
              {selected.type === "beat" ? (
                // A beat is planned spatially rather than written linearly. The
                // key remounts the canvas per beat, so pan/zoom and selection
                // reset instead of carrying over from the previous one.
                <BeatCanvas key={selected.id} beat={selected} />
              ) : selected.type === "folder" ? (
                <EmptyCanvas message="Folders hold other documents. Select a chapter or scene to write." />
              ) : (
                <Editor
                  // The version suffix remounts the editor after a snapshot
                  // restore: the node id is unchanged, so without it the
                  // editor would keep displaying the pre-restore text.
                  key={`${selected.id}:${docVersion}`}
                  node={selected}
                  projectId={initialProject.id}
                  onSave={saveBody}
                  onSaveStateChange={setSaveState}
                  onMentionClick={handleNavigate}
                  type={type}
                  typewriter={typewriter}
                  focusMode={false}
                />
              )}
            </>
          ) : (
            <EmptyCanvas message="Select something from the binder to begin." />
          )}
        </main>

        {showInspector && selected && (
          <Inspector
            node={selected}
            subtreeWordCount={selectedWords}
            breakdown={breakdown}
            onPatch={(patch) => handlePatch(selected.id, patch)}
            onRestored={handleRestored}
            onSelect={handleNavigate}
          />
        )}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete “${pendingDelete?.title ?? ""}”?`}
        message="It moves to the Trash, where you can restore it."
        detail={pendingDelete ? deleteDetail(pendingDelete, nodes) : null}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

/**
 * Says what is actually about to disappear. Deleting a chapter takes its scenes
 * with it, and a writer should be told that before confirming, not after.
 */
function deleteDetail(node: ClientNode, nodes: ClientNode[]): string | null {
  const descendants: ClientNode[] = [];
  let frontier = [node.id];
  while (frontier.length) {
    const next: string[] = [];
    for (const parent of frontier) {
      for (const n of nodes) {
        if (n.parentId === parent) {
          descendants.push(n);
          next.push(n.id);
        }
      }
    }
    frontier = next;
  }

  const words = node.wordCount + descendants.reduce((sum, n) => sum + n.wordCount, 0);
  const parts: string[] = [];
  if (descendants.length > 0) {
    parts.push(`${descendants.length} item${descendants.length === 1 ? "" : "s"} inside`);
  }
  if (words > 0) parts.push(`${formatCount(words)} words`);

  return parts.length ? parts.join(" · ") : null;
}

function TopBar({
  project,
  projects,
  user,
  selected,
  type,
  typeOpen,
  onTypeChange,
  onToggleType,
  saveState,
  stats,
  showBinder,
  showInspector,
  typewriter,
  theme,
  onToggleBinder,
  onToggleInspector,
  onToggleTypewriter,
  onToggleTheme,
}: {
  project: Project;
  projects: ProjectSummary[];
  user: SessionUser;
  selected: ClientNode | null;
  type: TypeSettings;
  typeOpen: boolean;
  onTypeChange: (next: TypeSettings) => void;
  onToggleType: () => void;
  saveState: SaveState;
  stats: ReturnType<typeof projectStats>;
  showBinder: boolean;
  showInspector: boolean;
  typewriter: boolean;
  theme: "light" | "dark";
  onToggleBinder: () => void;
  onToggleInspector: () => void;
  onToggleTypewriter: () => void;
  onToggleTheme: () => void;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--surface-raised)] px-3">
      <IconToggle active={showBinder} onClick={onToggleBinder} label="Toggle binder">
        <PanelLeft className="h-4 w-4" />
      </IconToggle>

      <div className="flex min-w-0 items-baseline gap-2">
        <ProjectSwitcher current={project} projects={projects} />
        {project.subtitle && (
          <span className="hidden truncate text-[11px] text-[var(--text-faint)] sm:inline">
            {project.subtitle}
          </span>
        )}
      </div>

      <div className="ml-auto flex items-center gap-3">
        <WordCountSummary stats={stats} />
        <SaveBadge state={saveState} />
        <IconToggle active={typewriter} onClick={onToggleTypewriter} label="Typewriter mode">
          <AlignCenter className="h-4 w-4" />
        </IconToggle>
        <IconToggle active={false} onClick={onToggleTheme} label="Toggle theme">
          {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
        </IconToggle>
        <IconToggle active={showInspector} onClick={onToggleInspector} label="Toggle inspector">
          <PanelRight className="h-4 w-4" />
        </IconToggle>
        <TypeMenu
          open={typeOpen}
          settings={type}
          onChange={onTypeChange}
          onToggle={onToggleType}
        />
        <ExportMenu projectId={project.id} selected={selected} />
        <UserMenu user={user} />
      </div>
    </header>
  );
}

/**
 * The book's length, with the full breakdown on hover.
 *
 * The headline number is manuscript prose only. Notes are shown separately
 * rather than folded in — a writer should never be told they have drafted
 * words they cannot read in order.
 */
function WordCountSummary({ stats }: { stats: ReturnType<typeof projectStats> }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="relative hidden sm:block"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span className="cursor-default text-[11px] tabular-nums text-[var(--text-faint)]">
        {formatCount(stats.manuscript)} words
      </span>

      {open && (
        <div className="animate-fade-in absolute right-0 top-6 z-50 w-56 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-3 shadow-[var(--shadow-pop)]">
          <div className="flex items-baseline justify-between">
            <span className="font-serif text-xl tabular-nums">
              {formatCount(stats.manuscript)}
            </span>
            {estimatedPages(stats.manuscript) >= 1 && (
              <span className="text-[10px] text-[var(--text-faint)]">
                ~{estimatedPages(stats.manuscript)} page
                {estimatedPages(stats.manuscript) === 1 ? "" : "s"}
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
            Manuscript
          </div>

          <dl className="mt-2.5 space-y-1 border-t border-[var(--border)] pt-2 text-[11px]">
            <Row label="Chapters" value={formatCount(stats.chapters)} />
            <Row label="Scenes" value={formatCount(stats.scenes)} />
            {stats.longestChapter && (
              <Row
                label="Longest"
                value={`${formatCount(stats.longestChapter.words)}w`}
                hint={stats.longestChapter.title}
              />
            )}
            {stats.shortestChapter && (
              <Row
                label="Shortest"
                value={`${formatCount(stats.shortestChapter.words)}w`}
                hint={stats.shortestChapter.title}
              />
            )}
          </dl>

          {stats.notes > 0 && (
            <div className="mt-2 border-t border-[var(--border)] pt-2 text-[11px] text-[var(--text-muted)]">
              <div className="flex justify-between">
                <span>Notes &amp; world</span>
                <span className="tabular-nums text-[var(--text-faint)]">
                  {formatCount(stats.notes)}
                </span>
              </div>
              <p className="mt-0.5 text-[10px] leading-snug text-[var(--text-faint)]">
                Not counted toward the book.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="shrink-0 text-[var(--text-muted)]">{label}</dt>
      <dd className="flex min-w-0 items-baseline gap-1.5">
        {hint && (
          <span className="truncate text-[10px] text-[var(--text-faint)]">{hint}</span>
        )}
        <span className="shrink-0 tabular-nums text-[var(--text)]">{value}</span>
      </dd>
    </div>
  );
}

function UserMenu({ user }: { user: SessionUser }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);

  const initials = user.name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");

  async function signOut() {
    if (busy) return;
    setBusy(true);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    // A full document navigation, deliberately not router.push: signing out
    // must discard every scrap of client state, and a soft navigation would
    // leave the previous user's tree and open document in memory.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/login";
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Account"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-semibold text-[var(--accent-contrast)]"
        style={{ background: "var(--accent)" }}
      >
        {initials || "?"}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="animate-fade-in absolute right-0 top-9 z-40 w-52 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] shadow-[var(--shadow-pop)]">
            <div className="border-b border-[var(--border)] px-3 py-2.5">
              <div className="truncate text-[13px] font-medium">{user.name}</div>
              <div className="truncate text-[11px] text-[var(--text-faint)]">{user.email}</div>
            </div>
            <button
              onClick={() => {
                setOpen(false);
                setPwOpen(true);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] transition-colors hover:bg-[var(--surface)]"
            >
              <KeyRound className="h-3.5 w-3.5" />
              Change password
            </button>
            <button
              onClick={() => void signOut()}
              disabled={busy}
              className="flex w-full items-center gap-2 border-t border-[var(--border)] px-3 py-2 text-left text-[12.5px] transition-colors hover:bg-[var(--surface)] disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
              Sign out
            </button>
          </div>
        </>
      )}

      <PasswordDialog open={pwOpen} onClose={() => setPwOpen(false)} />
    </div>
  );
}

function IconToggle({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cn(
        "grid h-7 w-7 shrink-0 place-items-center rounded-md transition-colors",
        active
          ? "bg-[var(--accent-soft)] text-[var(--accent)]"
          : "text-[var(--text-faint)] hover:bg-[var(--surface)] hover:text-[var(--text)]",
      )}
    >
      {children}
    </button>
  );
}

function SaveBadge({ state }: { state: SaveState }) {
  const map = {
    idle: { icon: null, text: "", className: "text-[var(--text-faint)]" },
    dirty: { icon: null, text: "Unsaved", className: "text-[var(--text-faint)]" },
    saving: {
      icon: <Loader2 className="h-3 w-3 animate-spin" />,
      text: "Saving",
      className: "text-[var(--text-muted)]",
    },
    saved: {
      icon: <Check className="h-3 w-3" />,
      text: "Saved",
      className: "text-[var(--status-revised)]",
    },
    error: {
      icon: <CloudOff className="h-3 w-3" />,
      text: "Save failed",
      className: "text-red-500",
    },
  }[state];

  if (!map.text) return <span className="w-16" />;

  return (
    <span
      className={cn(
        "flex w-16 items-center gap-1 text-[11px] transition-colors",
        map.className,
      )}
    >
      {map.icon}
      {map.text}
    </span>
  );
}

function EmptyCanvas({ message }: { message: string }) {
  return (
    <div className="grid flex-1 place-items-center px-8">
      <p className="max-w-sm text-center text-sm italic text-[var(--text-faint)]">{message}</p>
    </div>
  );
}
