import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useEditorStore } from "../store";
import { BlockCard } from "./BlockCard";
import { StatsBar } from "./StatsBar";
import { StatsPanel } from "./StatsPanel";
import * as api from "../api";
import { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";

export function DocumentEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    document, blocks, stats, loadDocument,
    updateBlock, createBlock, deleteBlock, splitBlock, mergeBlocks,
    setFocusState, lastFocusedBlockId, lastCursorPosition,
    disconnectSSE,
  } = useEditorStore();
  const [showStats, setShowStats] = useState(false);
  const viewRefs = useRef<Map<string, EditorView | null>>(new Map());

  useEffect(() => {
    if (id) loadDocument(id);
    return () => disconnectSSE();
  }, [id]);

  // Global keyboard: Enter to refocus last block when nothing is focused
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Only trigger when no CodeMirror editor is focused
      const active = window.document.activeElement;
      if (active?.closest(".cm-editor")) return;
      // Also skip if focused on input/button/textarea
      if (active && ["INPUT", "TEXTAREA", "BUTTON"].includes(active.tagName)) return;

      if (e.key === "Enter") {
        e.preventDefault();
        const { blocks: currentBlocks, lastFocusedBlockId: lastId, lastCursorPosition: lastPos } = useEditorStore.getState();
        if (currentBlocks.length === 0) return;

        const targetId = lastId && currentBlocks.some((b) => b.id === lastId) ? lastId : currentBlocks[0].id;
        const view = viewRefs.current.get(targetId);
        if (view) {
          view.focus();
          // Restore cursor position
          const pos = Math.min(lastId === targetId ? lastPos : 0, view.state.doc.length);
          view.dispatch({ selection: EditorSelection.cursor(pos) });
        }
      }
    };

    window.document.addEventListener("keydown", handler);
    return () => window.document.removeEventListener("keydown", handler);
  }, []);

  const handleUpdate = useCallback(
    async (blockId: string, content: string, version: number) => {
      const { blocks: currentBlocks } = useEditorStore.getState();
      if (!currentBlocks.some((b) => b.id === blockId)) return;

      try {
        return await updateBlock(blockId, content, version);
      } catch (err: any) {
        if (err.status === 409) {
          if (id) loadDocument(id);
        } else if (err.status === 404) {
          return;
        }
        throw err;
      }
    },
    [updateBlock, id, loadDocument]
  );

  // Flush a block's pending content to server, return latest version
  const flushBlock = useCallback(
    async (blockId: string): Promise<number> => {
      const view = viewRefs.current.get(blockId);
      const block = useEditorStore.getState().blocks.find((b) => b.id === blockId);
      if (!view || !block) return block?.version ?? 1;

      const currentContent = view.state.doc.toString();
      if (currentContent !== block.content) {
        const updated = await updateBlock(blockId, currentContent, block.version);
        return updated?.version ?? block.version;
      }
      return block.version;
    },
    [updateBlock]
  );

  const handleCreateAfter = useCallback(
    async (position: number) => {
      const newBlock = await createBlock("", position + 0.5);
      setTimeout(() => {
        if (newBlock) {
          viewRefs.current.get(newBlock.id)?.focus();
        }
      }, 50);
    },
    [createBlock]
  );

  const handleCreateBefore = useCallback(
    async (position: number) => {
      const newBlock = await createBlock("", position - 0.5);
      setTimeout(() => {
        if (newBlock) {
          viewRefs.current.get(newBlock.id)?.focus();
        }
      }, 50);
    },
    [createBlock]
  );

  const handleDelete = useCallback(
    async (blockId: string, version: number) => {
      if (blocks.length <= 1) return;
      const idx = blocks.findIndex((b) => b.id === blockId);
      await deleteBlock(blockId, version);
      const prevBlock = blocks[idx - 1] ?? blocks[idx + 1];
      if (prevBlock) {
        setTimeout(() => {
          const view = viewRefs.current.get(prevBlock.id);
          if (view) {
            view.focus();
            view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
          }
        }, 50);
      }
    },
    [blocks, deleteBlock]
  );

  const handleSplit = useCallback(
    async (blockId: string, position: number, version: number) => {
      try {
        // Flush pending content to server before splitting
        version = await flushBlock(blockId);
        const result = await splitBlock(blockId, position, version);
        if (result) {
          // Force update original block's editor content (it still shows old text)
          const origView = viewRefs.current.get(blockId);
          if (origView) {
            const origContent = origView.state.doc.toString();
            if (origContent !== result.original.content) {
              origView.dispatch({
                changes: { from: 0, to: origContent.length, insert: result.original.content },
              });
            }
          }
          setTimeout(() => {
            const newView = viewRefs.current.get(result.new.id);
            if (newView) {
              newView.focus();
              newView.dispatch({ selection: EditorSelection.cursor(0) });
            }
          }, 50);
        }
      } catch (err: any) {
        if (err.status === 409 && id) loadDocument(id);
      }
    },
    [splitBlock, id, loadDocument]
  );

  // Merge current block into previous (Backspace at position 0)
  const handleMergeWithPrevious = useCallback(
    async (blockId: string) => {
      const idx = blocks.findIndex((b) => b.id === blockId);
      if (idx <= 0) return;
      const prev = blocks[idx - 1];
      const curr = blocks[idx];
      try {
        // Flush both blocks before merging
        const prevVersion = await flushBlock(prev.id);
        const currVersion = await flushBlock(curr.id);
        // Get fresh content length after flush
        const prevBlock = useEditorStore.getState().blocks.find((b) => b.id === prev.id);
        const prevContentLen = prevBlock?.content.length ?? prev.content.length;

        await mergeBlocks(curr.id, prev.id, currVersion, prevVersion);
        setTimeout(() => {
          const view = viewRefs.current.get(prev.id);
          if (view) {
            view.focus();
            view.dispatch({ selection: EditorSelection.cursor(prevContentLen) });
          }
        }, 50);
      } catch (err: any) {
        if (err.status === 409 && id) loadDocument(id);
      }
    },
    [blocks, mergeBlocks, flushBlock, id, loadDocument]
  );

  // Merge next block into current (Delete at end)
  const handleMergeWithNext = useCallback(
    async (blockId: string) => {
      const idx = blocks.findIndex((b) => b.id === blockId);
      if (idx >= blocks.length - 1) return;
      const curr = blocks[idx];
      const next = blocks[idx + 1];
      try {
        const currVersion = await flushBlock(curr.id);
        const nextVersion = await flushBlock(next.id);
        const currBlock = useEditorStore.getState().blocks.find((b) => b.id === curr.id);
        const currContentLen = currBlock?.content.length ?? curr.content.length;

        await mergeBlocks(next.id, curr.id, nextVersion, currVersion);
        setTimeout(() => {
          const view = viewRefs.current.get(curr.id);
          if (view) {
            view.focus();
            view.dispatch({ selection: EditorSelection.cursor(currContentLen) });
          }
        }, 50);
      } catch (err: any) {
        if (err.status === 409 && id) loadDocument(id);
      }
    },
    [blocks, mergeBlocks, flushBlock, id, loadDocument]
  );

  // Focus helpers with cursor positioning
  const focusBlockAtEnd = useCallback(
    (fromId: string) => {
      const idx = blocks.findIndex((b) => b.id === fromId);
      const target = blocks[idx - 1];
      if (target) {
        const view = viewRefs.current.get(target.id);
        if (view) {
          view.focus();
          view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
        }
      }
    },
    [blocks]
  );

  const focusBlockAtStart = useCallback(
    (fromId: string) => {
      const idx = blocks.findIndex((b) => b.id === fromId);
      const target = blocks[idx + 1];
      if (target) {
        const view = viewRefs.current.get(target.id);
        if (view) {
          view.focus();
          view.dispatch({ selection: EditorSelection.cursor(0) });
        }
      }
    },
    [blocks]
  );

  const focusBlock = useCallback(
    (offset: number, fromId: string) => {
      const idx = blocks.findIndex((b) => b.id === fromId);
      const target = blocks[idx + offset];
      if (target) viewRefs.current.get(target.id)?.focus();
    },
    [blocks]
  );

  const handleFocusChange = useCallback(
    (blockId: string, cursorPos: number) => {
      setFocusState(blockId, cursorPos);
    },
    [setFocusState]
  );

  const handleExport = async (format: "md" | "full") => {
    if (!id) return;
    const data = await api.exportDocument(id, format);
    const blob = new Blob(
      [typeof data === "string" ? data : JSON.stringify(data, null, 2)],
      { type: "application/octet-stream" }
    );
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement("a");
    a.href = url;
    a.download = format === "md" ? `${document?.title ?? "doc"}.md` : `${document?.title ?? "doc"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!document) return <div className="page loading">加载中...</div>;

  return (
    <div className="page editor-page">
      <header className="editor-header">
        <button className="btn btn-back" onClick={() => navigate("/")}>
          &larr; 返回
        </button>
        <h2>{document.title}</h2>
        <div className="header-actions">
          <button className="btn" onClick={() => handleExport("md")}>
            导出 MD
          </button>
          <button className="btn" onClick={() => handleExport("full")}>
            导出 Full
          </button>
        </div>
      </header>

      <div className="block-list">
        {blocks.map((block, idx) => (
          <BlockCard
            key={block.id}
            block={block}
            onUpdate={handleUpdate}
            onDelete={handleDelete}
            onSplit={handleSplit}
            onCreateAfter={handleCreateAfter}
            onCreateBefore={handleCreateBefore}
            onMergeWithPrevious={idx > 0 ? handleMergeWithPrevious : undefined}
            onMergeWithNext={idx < blocks.length - 1 ? handleMergeWithNext : undefined}
            onFocusNext={() => focusBlock(1, block.id)}
            onFocusPrev={() => focusBlock(-1, block.id)}
            onFocusPrevEnd={() => focusBlockAtEnd(block.id)}
            onFocusNextStart={() => focusBlockAtStart(block.id)}
            onFocusChange={handleFocusChange}
            focusRef={(view) => {
              if (view) viewRefs.current.set(block.id, view);
              else viewRefs.current.delete(block.id);
            }}
          />
        ))}
      </div>

      <button
        className="btn btn-new-block"
        onClick={() => {
          const lastPos = blocks.length > 0 ? blocks[blocks.length - 1].position : 0;
          createBlock("", lastPos + 1);
        }}
      >
        + 新建段落
      </button>

      <StatsBar stats={stats} onTogglePanel={() => setShowStats(!showStats)} showPanel={showStats} />
      {showStats && stats && <StatsPanel stats={stats} />}
    </div>
  );
}
