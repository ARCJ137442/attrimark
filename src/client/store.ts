import { create } from "zustand";
import * as api from "./api";

interface EditorStore {
  // Document list
  documents: any[];
  loadDocuments(): Promise<void>;

  // Current document
  document: any | null;
  blocks: any[];
  stats: any | null;

  loadDocument(id: string): Promise<void>;
  createBlock(content: string, position?: number): Promise<any>;
  updateBlock(blockId: string, content: string, version: number): Promise<any>;
  deleteBlock(blockId: string, version: number): Promise<void>;
  splitBlock(blockId: string, position: number, version: number): Promise<any>;
  mergeBlocks(sourceId: string, targetId: string, sourceVersion: number, targetVersion: number): Promise<any>;

  // Focus tracking
  lastFocusedBlockId: string | null;
  lastCursorPosition: number;
  setFocusState(blockId: string | null, cursorPos?: number): void;

  // SSE
  eventSource: EventSource | null;
  connectSSE(documentId: string): void;
  disconnectSSE(): void;

  // Local block updates (from SSE or optimistic)
  _updateLocalBlock(block: any): void;
  _removeLocalBlock(blockId: string): void;
  _addLocalBlock(block: any): void;
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  documents: [],
  document: null,
  blocks: [],
  stats: null,
  eventSource: null,
  lastFocusedBlockId: null,
  lastCursorPosition: 0,

  async loadDocuments() {
    const documents = await api.listDocuments();
    set({ documents });
  },

  async loadDocument(id: string) {
    const data = await api.getDocument(id);
    set({
      document: { id: data.id, title: data.title, createdAt: data.createdAt, updatedAt: data.updatedAt },
      blocks: data.blocks,
      stats: data.stats,
    });
    get().connectSSE(id);
  },

  async createBlock(content: string, position?: number) {
    const { document } = get();
    if (!document) return;
    const block = await api.createBlock(document.id, content, position);
    get()._addLocalBlock(block);
    return block;
  },

  async updateBlock(blockId: string, content: string, version: number) {
    const { document } = get();
    if (!document) return;
    const block = await api.updateBlock(document.id, blockId, content, version);
    get()._updateLocalBlock(block);
    return block;
  },

  async deleteBlock(blockId: string, version: number) {
    const { document } = get();
    if (!document) return;
    await api.deleteBlockApi(document.id, blockId, version);
    get()._removeLocalBlock(blockId);
  },

  async splitBlock(blockId: string, position: number, version: number) {
    const { document } = get();
    if (!document) return;
    const result = await api.splitBlock(document.id, blockId, position, version);
    get()._updateLocalBlock(result.original);
    get()._addLocalBlock(result.new);
    return result;
  },

  async mergeBlocks(sourceId: string, targetId: string, sourceVersion: number, targetVersion: number) {
    const { document } = get();
    if (!document) return;
    const result = await api.mergeBlocks(document.id, sourceId, targetId, sourceVersion, targetVersion);
    get()._updateLocalBlock(result.merged);
    get()._removeLocalBlock(sourceId);
    return result;
  },

  setFocusState(blockId: string | null, cursorPos?: number) {
    set({
      lastFocusedBlockId: blockId,
      lastCursorPosition: cursorPos ?? 0,
    });
  },

  connectSSE(documentId: string) {
    get().disconnectSSE();
    // SSE connects directly to backend to avoid Vite proxy buffering
    const sseBase = import.meta.env.DEV ? "http://localhost:12479" : "";
    const es = new EventSource(`${sseBase}/api/documents/${documentId}/events`);

    es.addEventListener("block_created", (e) => {
      const block = JSON.parse(e.data);
      get()._addLocalBlock(block);
    });

    es.addEventListener("block_updated", (e) => {
      const block = JSON.parse(e.data);
      get()._updateLocalBlock(block);
    });

    es.addEventListener("block_deleted", (e) => {
      const { id } = JSON.parse(e.data);
      get()._removeLocalBlock(id);
    });

    es.addEventListener("stats_changed", (e) => {
      const stats = JSON.parse(e.data);
      set({ stats });
    });

    set({ eventSource: es });
  },

  disconnectSSE() {
    const { eventSource } = get();
    if (eventSource) {
      eventSource.close();
      set({ eventSource: null });
    }
  },

  _updateLocalBlock(block: any) {
    set((state) => ({
      blocks: state.blocks.map((b) => (b.id === block.id ? block : b)),
    }));
  },

  _removeLocalBlock(blockId: string) {
    set((state) => ({
      blocks: state.blocks.filter((b) => b.id !== blockId),
    }));
  },

  _addLocalBlock(block: any) {
    set((state) => {
      if (state.blocks.some((b) => b.id === block.id)) return state;
      const blocks = [...state.blocks, block].sort((a, b) => a.position - b.position);
      return { blocks };
    });
  },
}));
