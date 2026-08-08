"use client";

import {
  BookOpen,
  Folder,
  Landmark,
  Layers,
  MapPin,
  ScrollText,
  Square,
  StickyNote,
  Target,
  User,
} from "lucide-react";

import type { NodeType } from "@/db/schema";

/** One place mapping node types and statuses to their visual language. */

export const NODE_ICONS: Record<NodeType, typeof Folder> = {
  folder: Folder,
  act: Layers,
  chapter: BookOpen,
  scene: ScrollText,
  note: StickyNote,
  character: User,
  location: MapPin,
  lore: Landmark,
  beat: Target,
  card: Square,
};

export function NodeIcon({
  type,
  className,
}: {
  type: NodeType;
  className?: string;
}) {
  const Icon = NODE_ICONS[type] ?? Folder;
  return <Icon className={className} strokeWidth={1.75} aria-hidden />;
}

export const STATUS_ORDER = ["todo", "outline", "draft", "revised", "final"] as const;
export type Status = (typeof STATUS_ORDER)[number];

export const STATUS_LABEL: Record<Status, string> = {
  todo: "To do",
  outline: "Outline",
  draft: "Draft",
  revised: "Revised",
  final: "Final",
};

export function statusColor(status?: string): string {
  switch (status) {
    case "outline":
      return "var(--status-outline)";
    case "draft":
      return "var(--status-draft)";
    case "revised":
      return "var(--status-revised)";
    case "final":
      return "var(--status-final)";
    default:
      return "var(--status-todo)";
  }
}

export function StatusDot({ status }: { status?: string }) {
  return (
    <span
      className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
      style={{ background: statusColor(status) }}
      title={STATUS_LABEL[(status as Status) ?? "todo"] ?? "To do"}
    />
  );
}
