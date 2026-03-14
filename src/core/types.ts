// === Attribution ===

export interface AttributionSpan {
  s: "human" | "agent";
  n: number;
}

export type SourceType = "human" | "agent";
export type DerivedSource = "human" | "agent" | "mixed";

// === Block ===

export interface Block {
  id: string;
  documentId: string;
  content: string;
  attribution: AttributionSpan[];
  lastSource: SourceType;
  position: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface BlockDerived {
  source: DerivedSource;
  humanChars: number;
  agentChars: number;
  humanPercent: number;
  agentPercent: number;
}

// === Document ===

export interface Document {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

// === Edit Log ===

export interface EditLog {
  id: string;
  blockId: string;
  documentId: string;
  authorType: SourceType;
  authorName?: string;
  charDelta: number;
  timestamp: string;
}

// === Stats ===

export interface DocumentStats {
  totalBlocks: number;
  totalChars: number;
  humanChars: number;
  agentChars: number;
  humanPercent: number;
  agentPercent: number;
  sourceBreakdown: { human: number; agent: number; mixed: number };
  timeline: { timestamp: string; humanChars: number; agentChars: number }[];
}

// === API Types ===

export interface Author {
  type: SourceType;
  name?: string;
}

export interface CreateBlockInput {
  content: string;
  author: Author;
  position?: number;
}

export interface UpdateBlockInput {
  content: string;
  author: Author;
  version: number;
}

export interface PatchBlockInput {
  old: string;
  new: string;
  author: Author;
  version: number;
}

export interface ImportInput {
  markdown: string;
  provenance?: ProvenanceExport;
  defaultSource?: SourceType;
}

export interface ProvenanceExport {
  version: number;
  documentId: string;
  title: string;
  blocks: {
    id: string;
    position: number;
    attribution: AttributionSpan[];
    lastSource: SourceType;
  }[];
  stats: {
    totalChars: number;
    humanChars: number;
    agentChars: number;
    humanPercent: number;
    agentPercent: number;
  };
  exportedAt: string;
}

// === SSE Events ===

export type SSEEventType =
  | "block_created"
  | "block_updated"
  | "block_deleted"
  | "stats_changed";

export interface SSEEvent {
  type: SSEEventType;
  data: unknown;
}
