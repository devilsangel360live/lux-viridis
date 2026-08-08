import type { Node, NodeRoot, NodeType, Project } from "@/db/schema";

export type ClientNode = Omit<Node, "createdAt" | "updatedAt"> & {
  createdAt: string | number | Date;
  updatedAt: string | number | Date;
};

export type TreeNode = ClientNode & { children: TreeNode[] };

export type WorkspacePayload = { project: Project; nodes: ClientNode[] };

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchWorkspace(projectId?: string): Promise<WorkspacePayload> {
  const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
  return json(await fetch(`/api/nodes${qs}`, { cache: "no-store" }));
}

export async function createNode(input: {
  projectId?: string;
  parentId: string | null;
  root: NodeRoot;
  type: NodeType;
  title?: string;
}): Promise<{ node: ClientNode }> {
  return json(
    await fetch("/api/nodes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export async function patchNode(
  id: string,
  patch: {
    title?: string;
    body?: unknown;
    synopsis?: string | null;
    meta?: Record<string, unknown>;
    collapsed?: boolean;
  },
): Promise<{ node: ClientNode }> {
  return json(
    await fetch(`/api/nodes/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }),
  );
}

export async function moveNodeRequest(
  id: string,
  input: { parentId: string | null; position: number },
): Promise<{ node: ClientNode }> {
  return json(
    await fetch(`/api/nodes/${id}/move`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export async function deleteNodeRequest(id: string): Promise<{ ok: boolean }> {
  return json(await fetch(`/api/nodes/${id}`, { method: "DELETE" }));
}

/** Client-side mirror of the server tree assembly. */
export function buildTree(rows: ClientNode[], root?: NodeRoot): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const r of rows) byId.set(r.id, { ...r, children: [] });

  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId)!.children.push(node);
      continue;
    }
    if (!root || node.root === root) roots.push(node);
  }

  const sortRec = (list: TreeNode[]) => {
    list.sort((a, b) => (a.idx === b.idx ? a.id.localeCompare(b.id) : a.idx < b.idx ? -1 : 1));
    list.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

/** Sum of a node's own words plus its whole subtree — what the binder shows. */
export function subtreeWords(node: TreeNode): number {
  return node.wordCount + node.children.reduce((sum, c) => sum + subtreeWords(c), 0);
}

/** Flatten visible nodes in display order, respecting collapse state. */
export function flattenVisible(
  tree: TreeNode[],
  collapsed: Set<string>,
  depth = 0,
): Array<{ node: TreeNode; depth: number }> {
  const out: Array<{ node: TreeNode; depth: number }> = [];
  for (const node of tree) {
    out.push({ node, depth });
    if (!collapsed.has(node.id)) {
      out.push(...flattenVisible(node.children, collapsed, depth + 1));
    }
  }
  return out;
}
