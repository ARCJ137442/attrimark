import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useEditorStore } from "../store";
import { BlockCard } from "./BlockCard";
import { StatsBar } from "./StatsBar";
import { StatsPanel } from "./StatsPanel";
import * as api from "../api";
import type { EditorView } from "@codemirror/view";

export function DocumentEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { document, blocks, stats, loadDocument, updateBlock, createBlock, deleteBlock, disconnectSSE } =
    useEditorStore();
  const [showStats, setShowStats] = useState(false);
  const viewRefs = useRef<Map<string, EditorView | null>>(new Map());

  useEffect(() => {
    if (id) loadDocument(id);
    return () => disconnectSSE();
  }, [id]);

  const handleUpdate = useCallback(
    async (blockId: string, content: string, version: number) => {
      try {
        return await updateBlock(blockId, content, version);
      } catch (err: any) {
        if (err.status === 409) {
          // Conflict — reload
          if (id) loadDocument(id);
        }
        throw err;
      }
    },
    [updateBlock, id, loadDocument]
  );

  const handleCreateAfter = useCallback(
    async (position: number) => {
      const newBlock = await createBlock("", position + 0.5);
      // Focus the new block after it renders
      setTimeout(() => {
        if (newBlock) {
          const view = viewRefs.current.get(newBlock.id);
          view?.focus();
        }
      }, 50);
    },
    [createBlock]
  );

  const handleDelete = useCallback(
    async (blockId: string, version: number) => {
      if (blocks.length <= 1) return; // Don't delete last block
      const idx = blocks.findIndex((b) => b.id === blockId);
      await deleteBlock(blockId, version);
      // Focus previous block
      const prevBlock = blocks[idx - 1] ?? blocks[idx + 1];
      if (prevBlock) {
        setTimeout(() => {
          viewRefs.current.get(prevBlock.id)?.focus();
        }, 50);
      }
    },
    [blocks, deleteBlock]
  );

  const handleMerge = useCallback(
    async (blockId: string) => {
      const idx = blocks.findIndex((b) => b.id === blockId);
      if (idx <= 0) return;
      const prev = blocks[idx - 1];
      const curr = blocks[idx];
      // Merge: append current content to previous
      const mergedContent = prev.content + "\n" + curr.content;
      await updateBlock(prev.id, mergedContent, prev.version);
      await deleteBlock(curr.id, curr.version);
      setTimeout(() => viewRefs.current.get(prev.id)?.focus(), 50);
    },
    [blocks, updateBlock, deleteBlock]
  );

  const focusBlock = useCallback(
    (offset: number, fromId: string) => {
      const idx = blocks.findIndex((b) => b.id === fromId);
      const target = blocks[idx + offset];
      if (target) viewRefs.current.get(target.id)?.focus();
    },
    [blocks]
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
            onCreateAfter={handleCreateAfter}
            onMergeWithPrevious={idx > 0 ? handleMerge : undefined}
            onFocusNext={() => focusBlock(1, block.id)}
            onFocusPrev={() => focusBlock(-1, block.id)}
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
