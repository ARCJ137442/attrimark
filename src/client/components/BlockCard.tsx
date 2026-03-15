import { useEffect, useRef, useCallback } from "react";
import { EditorView, keymap, Decoration, type DecorationSet, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { EditorState, type Extension, RangeSetBuilder, Prec } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import type { AttributionSpan } from "../../core/types";

interface BlockCardProps {
  block: {
    id: string;
    content: string;
    attribution: AttributionSpan[];
    lastSource: "human" | "agent";
    version: number;
    position: number;
    source: "human" | "agent" | "mixed";
    humanChars: number;
    agentChars: number;
    humanPercent: number;
    agentPercent: number;
  };
  onUpdate: (blockId: string, content: string, version: number) => Promise<any>;
  onDelete: (blockId: string, version: number) => void;
  onSplit: (blockId: string, position: number, version: number) => void;
  onCreateAfter: (position: number) => void;
  onCreateBefore: (position: number) => void;
  onMergeWithPrevious?: (blockId: string) => void;
  onMergeWithNext?: (blockId: string) => void;
  onFocusNext?: () => void;
  onFocusPrev?: () => void;
  onFocusPrevEnd?: () => void;
  onFocusNextStart?: () => void;
  onFocusChange?: (blockId: string, cursorPos: number) => void;
  focusRef?: (view: EditorView | null) => void;
}

// Decoration marks for attribution
const humanMark = Decoration.mark({ class: "attr-human" });
const agentMark = Decoration.mark({ class: "attr-agent" });

function buildDecorations(attribution: AttributionSpan[]): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  let pos = 0;
  for (const span of attribution) {
    const mark = span.s === "human" ? humanMark : agentMark;
    if (span.n > 0) {
      builder.add(pos, pos + span.n, mark);
    }
    pos += span.n;
  }
  return builder.finish();
}

export function BlockCard({
  block,
  onUpdate,
  onDelete,
  onSplit,
  onCreateAfter,
  onCreateBefore,
  onMergeWithPrevious,
  onMergeWithNext,
  onFocusNext,
  onFocusPrev,
  onFocusPrevEnd,
  onFocusNextStart,
  onFocusChange,
  focusRef,
}: BlockCardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blockRef = useRef(block);

  blockRef.current = block;

  const handleChange = useCallback(
    (content: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const b = blockRef.current;
        onUpdate(b.id, content, b.version);
      }, 500);
    },
    [onUpdate]
  );

  useEffect(() => {
    if (!containerRef.current) return;

    const attributionPlugin = ViewPlugin.define(
      () => ({
        decorations: buildDecorations(blockRef.current.attribution),
        update(update: ViewUpdate) {
          if (update.docChanged) {
            this.decorations = buildDecorations(blockRef.current.attribution);
          }
        },
      }),
      { decorations: (v) => v.decorations }
    );

    const customKeymap = keymap.of([
      // Shift+Enter: split block at cursor
      {
        key: "Shift-Enter",
        run: (view) => {
          const pos = view.state.selection.main.head;
          const b = blockRef.current;
          // Flush pending changes before split
          if (debounceRef.current) {
            clearTimeout(debounceRef.current);
            debounceRef.current = null;
          }
          onSplit(b.id, pos, b.version);
          return true;
        },
      },
      // Ctrl+Enter: insert empty block after
      {
        key: "Mod-Enter",
        run: () => {
          onCreateAfter(blockRef.current.position);
          return true;
        },
      },
      // Ctrl+Shift+Enter: insert empty block before
      {
        key: "Mod-Shift-Enter",
        run: () => {
          onCreateBefore(blockRef.current.position);
          return true;
        },
      },
      // Backspace at position 0
      {
        key: "Backspace",
        run: (view) => {
          const pos = view.state.selection.main.head;
          if (pos !== 0) return false;
          if (view.state.doc.length === 0) {
            onDelete(blockRef.current.id, blockRef.current.version);
            return true;
          }
          if (onMergeWithPrevious) {
            // Flush pending changes before merge
            if (debounceRef.current) {
              clearTimeout(debounceRef.current);
              debounceRef.current = null;
            }
            onMergeWithPrevious(blockRef.current.id);
            return true;
          }
          return false;
        },
      },
      // Delete at end of block
      {
        key: "Delete",
        run: (view) => {
          const pos = view.state.selection.main.head;
          const docLen = view.state.doc.length;
          if (pos !== docLen) return false;
          if (onMergeWithNext) {
            if (debounceRef.current) {
              clearTimeout(debounceRef.current);
              debounceRef.current = null;
            }
            onMergeWithNext(blockRef.current.id);
            return true;
          }
          return false;
        },
      },
      // Arrow up/left at position 0 → jump to previous block end
      {
        key: "ArrowUp",
        run: (view) => {
          if (view.state.selection.main.head === 0) {
            onFocusPrevEnd?.();
            return true;
          }
          return false;
        },
      },
      {
        key: "ArrowLeft",
        run: (view) => {
          if (view.state.selection.main.head === 0) {
            onFocusPrevEnd?.();
            return true;
          }
          return false;
        },
      },
      // Arrow down/right at end → jump to next block start
      {
        key: "ArrowDown",
        run: (view) => {
          if (view.state.selection.main.head === view.state.doc.length) {
            onFocusNextStart?.();
            return true;
          }
          return false;
        },
      },
      {
        key: "ArrowRight",
        run: (view) => {
          if (view.state.selection.main.head === view.state.doc.length) {
            onFocusNextStart?.();
            return true;
          }
          return false;
        },
      },
      // Tab navigation
      {
        key: "Tab",
        run: () => {
          onFocusNext?.();
          return true;
        },
      },
      {
        key: "Shift-Tab",
        run: () => {
          onFocusPrev?.();
          return true;
        },
      },
    ]);

    const extensions: Extension[] = [
      Prec.highest(customKeymap),
      markdown({ codeLanguages: languages }),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      attributionPlugin,
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          handleChange(update.state.doc.toString());
        }
        // Track focus + cursor position
        if (update.focusChanged && update.view.hasFocus) {
          onFocusChange?.(blockRef.current.id, update.state.selection.main.head);
        }
      }),
      EditorView.theme({
        "&": { fontSize: "14px" },
        ".cm-content": { padding: "8px 12px", fontFamily: "'SF Mono', Monaco, 'Cascadia Code', monospace" },
        ".cm-focused": { outline: "none" },
      }),
    ];

    const view = new EditorView({
      state: EditorState.create({
        doc: block.content,
        extensions,
      }),
      parent: containerRef.current,
    });

    viewRef.current = view;
    focusRef?.(view);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      view.destroy();
      viewRef.current = null;
      focusRef?.(null);
    };
  }, [block.id]);

  // Update content from external changes (SSE)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentContent = view.state.doc.toString();
    if (currentContent !== block.content && !view.hasFocus) {
      view.dispatch({
        changes: { from: 0, to: currentContent.length, insert: block.content },
      });
    }
  }, [block.content, block.version]);

  const sourceLabel =
    block.source === "human" ? "● human" : block.source === "agent" ? "◆ agent" : "◇ mixed";
  const sourceClass = `card-${block.source}`;

  const totalChars = block.humanChars + block.agentChars;

  return (
    <div className={`block-card ${sourceClass}`}>
      <div className="card-header">
        <span className={`source-badge source-${block.source}`}>{sourceLabel}</span>
        <span className="char-count">{totalChars} chars</span>
      </div>
      <div className="cm-container" ref={containerRef} />
      <div className="card-footer">
        <div className="attribution-bar">
          {block.humanChars > 0 && (
            <div
              className="attr-bar-human"
              style={{ width: `${block.humanPercent}%` }}
              title={`Human: ${block.humanChars} chars (${block.humanPercent.toFixed(1)}%)`}
            />
          )}
          {block.agentChars > 0 && (
            <div
              className="attr-bar-agent"
              style={{ width: `${block.agentPercent}%` }}
              title={`Agent: ${block.agentChars} chars (${block.agentPercent.toFixed(1)}%)`}
            />
          )}
        </div>
        <span className="footer-stats">
          {block.humanChars > 0 && <span className="stat-human">H:{block.humanChars}</span>}
          {block.agentChars > 0 && <span className="stat-agent">A:{block.agentChars}</span>}
        </span>
      </div>
    </div>
  );
}
