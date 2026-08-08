"use client";

import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import Mention from "@tiptap/extension-mention";

import type { ClientNode } from "@/lib/api";
import { cn } from "@/lib/utils";
import { createMentionSuggestion, type MentionItem } from "./mention-suggestion";
import { fontById, type TypeSettings } from "@/lib/fonts";

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

/**
 * The writing canvas.
 *
 * Autosave is debounced and keyed on node id. The `skipNextUpdate` ref matters:
 * `setContent` when switching documents fires onUpdate, which would otherwise
 * immediately mark the newly-opened node dirty and save it back over itself.
 */
export function Editor({
  node,
  projectId,
  onSave,
  onSaveStateChange,
  onMentionClick,
  type,
  typewriter,
  focusMode,
}: {
  node: ClientNode;
  projectId: string;
  onSave: (id: string, body: unknown) => Promise<void>;
  onSaveStateChange: (state: SaveState) => void;
  onMentionClick: (id: string) => void;
  type: TypeSettings;
  typewriter: boolean;
  focusMode: boolean;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextUpdate = useRef(false);
  const currentId = useRef(node.id);
  const [, force] = useState(0);

  /**
   * Mention candidates, loaded once per editor mount. The ref keeps the
   * suggestion config stable — rebuilding it would tear down the extension on
   * every render and drop the open popup.
   */
  const mentionItems = useRef<MentionItem[]>([]);
  const onMentionClickRef = useRef(onMentionClick);

  useEffect(() => {
    onMentionClickRef.current = onMentionClick;
  }, [onMentionClick]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(
        `/api/mentionable?projectId=${encodeURIComponent(projectId)}`,
        { cache: "no-store" },
      );
      const data = await res.json();
      if (!cancelled) mentionItems.current = data.items ?? [];
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const editor = useEditor(
    {
      immediatelyRender: false,
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
        }),
        Placeholder.configure({
          placeholder: "Begin where the trouble starts…",
        }),
        CharacterCount,
        Mention.configure({
          HTMLAttributes: { class: "vl-mention" },
          // Store the id alongside the label so the saved document carries the
          // link target, not just the name the reader sees.
          renderHTML({ options, node }) {
            return [
              "span",
              {
                ...options.HTMLAttributes,
                "data-mention-id": node.attrs.id,
              },
              `@${node.attrs.label ?? node.attrs.id}`,
            ];
          },
          // The callback runs on keystrokes inside ProseMirror, never during a
          // React render, so reading the ref here is safe.
          // eslint-disable-next-line react-hooks/refs
          suggestion: createMentionSuggestion(() => mentionItems.current),
        }),
      ],
      content: (node.body as object) ?? { type: "doc", content: [{ type: "paragraph" }] },
      editorProps: {
        attributes: {
          class: "prose-canvas focus:outline-none",
          spellcheck: "true",
        },
        // The indent class is applied by the effect below rather than here:
        // this config is built once, so it cannot react to the open document
        // changing from a scene to a character sheet.
        // Clicking a mention opens that entity. Handled here rather than with a
        // React onClick because the mention is rendered by ProseMirror.
        handleClick(_view, _pos, event) {
          const el = (event.target as HTMLElement)?.closest("[data-mention-id]");
          const id = el?.getAttribute("data-mention-id");
          if (id) {
            onMentionClickRef.current(id);
            return true;
          }
          return false;
        },
      },
      onUpdate: ({ editor }) => {
        if (skipNextUpdate.current) {
          skipNextUpdate.current = false;
          return;
        }
        onSaveStateChange("dirty");
        force((n) => n + 1); // refresh the live word count

        if (timer.current) clearTimeout(timer.current);
        const id = currentId.current;
        const json = editor.getJSON();

        timer.current = setTimeout(async () => {
          onSaveStateChange("saving");
          try {
            await onSave(id, json);
            onSaveStateChange("saved");
          } catch {
            onSaveStateChange("error");
          }
        }, 800);
      },
    },
    [],
  );

  // Swap document content when the selected node changes.
  useEffect(() => {
    if (!editor) return;
    if (currentId.current === node.id) return;

    // Flush a pending save for the outgoing node before switching away.
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
      const outgoingId = currentId.current;
      const json = editor.getJSON();
      void onSave(outgoingId, json).catch(() => onSaveStateChange("error"));
    }

    currentId.current = node.id;
    skipNextUpdate.current = true;
    editor.commands.setContent(
      (node.body as object) ?? { type: "doc", content: [{ type: "paragraph" }] },
    );
    onSaveStateChange("idle");
    force((n) => n + 1);
  }, [node.id, node.body, editor, onSave, onSaveStateChange]);

  /**
   * Book-style paragraph indents apply to manuscript prose only. Toggled on the
   * live DOM node because TipTap's editorProps are fixed at construction.
   */
  useEffect(() => {
    const el = editor?.view.dom;
    if (!el) return;
    el.classList.toggle("indent-prose", node.root === "manuscript");
  }, [editor, node.root, node.id]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  if (!editor) {
    return <div className="px-8 py-10 text-sm text-[var(--text-faint)]">Loading editor…</div>;
  }

  return (
    <div className={cn("relative h-full overflow-y-auto", typewriter && "typewriter")}>
      <div
        className={cn(
          "mx-auto w-full px-6 py-10 transition-opacity sm:px-10",
          // ~65 characters is the classic comfortable measure for long prose.
          "max-w-[68ch]",
          focusMode && "opacity-100",
        )}
        // Typography is applied here rather than in the stylesheet so the
        // choice takes effect without reloading or remounting the editor.
        style={{
          fontFamily: fontById(type.font).stack,
          fontSize: `${type.size}rem`,
          lineHeight: type.leading,
        }}
      >
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
