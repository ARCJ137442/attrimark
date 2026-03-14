import { Database } from "bun:sqlite";
import { nanoid } from "nanoid";
import type {
  Block,
  Document,
  AttributionSpan,
  SourceType,
  DocumentStats,
  EditLog,
} from "../core/types";
import { computeBlockDerived } from "../core/attribution";

let db: Database;

export function getDb(): Database {
  if (!db) {
    db = new Database("provenance.db");
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS blocks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      content TEXT NOT NULL DEFAULT '',
      attribution TEXT NOT NULL DEFAULT '[]',
      last_source TEXT NOT NULL DEFAULT 'human' CHECK (last_source IN ('human', 'agent')),
      position REAL NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS edit_logs (
      id TEXT PRIMARY KEY,
      block_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      author_type TEXT NOT NULL CHECK (author_type IN ('human', 'agent')),
      author_name TEXT,
      char_delta INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_blocks_doc ON blocks(document_id, position);
    CREATE INDEX IF NOT EXISTS idx_edit_logs_doc ON edit_logs(document_id, created_at);
  `);
}

// === Documents ===

export function listDocuments(): Document[] {
  return getDb()
    .query("SELECT id, title, created_at as createdAt, updated_at as updatedAt FROM documents ORDER BY updated_at DESC")
    .all() as Document[];
}

export function getDocument(id: string): Document | null {
  return getDb()
    .query("SELECT id, title, created_at as createdAt, updated_at as updatedAt FROM documents WHERE id = ?")
    .get(id) as Document | null;
}

export function createDocument(title: string): Document {
  const id = nanoid();
  const now = new Date().toISOString();
  getDb()
    .query("INSERT INTO documents (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .run(id, title, now, now);
  return { id, title, createdAt: now, updatedAt: now };
}

export function deleteDocument(id: string): boolean {
  const result = getDb().query("DELETE FROM documents WHERE id = ?").run(id);
  return result.changes > 0;
}

function touchDocument(id: string) {
  getDb()
    .query("UPDATE documents SET updated_at = datetime('now') WHERE id = ?")
    .run(id);
}

// === Blocks ===

export function listBlocks(documentId: string): Block[] {
  const rows = getDb()
    .query(
      `SELECT id, document_id as documentId, content, attribution, last_source as lastSource,
              position, version, created_at as createdAt, updated_at as updatedAt
       FROM blocks WHERE document_id = ? ORDER BY position`
    )
    .all(documentId) as any[];
  return rows.map(parseBlockRow);
}

export function getBlock(id: string): Block | null {
  const row = getDb()
    .query(
      `SELECT id, document_id as documentId, content, attribution, last_source as lastSource,
              position, version, created_at as createdAt, updated_at as updatedAt
       FROM blocks WHERE id = ?`
    )
    .get(id) as any;
  return row ? parseBlockRow(row) : null;
}

function parseBlockRow(row: any): Block {
  return {
    ...row,
    attribution: JSON.parse(row.attribution),
  };
}

export function createBlock(
  documentId: string,
  content: string,
  attribution: AttributionSpan[],
  lastSource: SourceType,
  position?: number
): Block {
  const id = nanoid();
  const now = new Date().toISOString();

  if (position === undefined) {
    const maxPos = getDb()
      .query("SELECT MAX(position) as mp FROM blocks WHERE document_id = ?")
      .get(documentId) as any;
    position = (maxPos?.mp ?? 0) + 1;
  }

  getDb()
    .query(
      `INSERT INTO blocks (id, document_id, content, attribution, last_source, position, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
    )
    .run(id, documentId, content, JSON.stringify(attribution), lastSource, position, now, now);

  touchDocument(documentId);

  return {
    id,
    documentId,
    content,
    attribution,
    lastSource,
    position,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

export interface UpdateBlockResult {
  block: Block;
  charDelta: number;
}

export function updateBlock(
  id: string,
  content: string,
  attribution: AttributionSpan[],
  lastSource: SourceType,
  expectedVersion: number
): UpdateBlockResult | { conflict: true; block: Block } {
  const existing = getBlock(id);
  if (!existing) throw new Error("Block not found");
  if (existing.version !== expectedVersion) {
    return { conflict: true, block: existing };
  }

  const now = new Date().toISOString();
  const newVersion = existing.version + 1;
  const charDelta = content.length - existing.content.length;

  getDb()
    .query(
      `UPDATE blocks SET content = ?, attribution = ?, last_source = ?, version = ?, updated_at = ?
       WHERE id = ? AND version = ?`
    )
    .run(content, JSON.stringify(attribution), lastSource, newVersion, now, id, expectedVersion);

  touchDocument(existing.documentId);

  const block: Block = {
    ...existing,
    content,
    attribution,
    lastSource,
    version: newVersion,
    updatedAt: now,
  };

  return { block, charDelta };
}

export function deleteBlock(
  id: string,
  expectedVersion: number
): { deleted: true; documentId: string } | { conflict: true; block: Block } {
  const existing = getBlock(id);
  if (!existing) throw new Error("Block not found");
  if (existing.version !== expectedVersion) {
    return { conflict: true, block: existing };
  }

  getDb().query("DELETE FROM blocks WHERE id = ?").run(id);
  touchDocument(existing.documentId);

  return { deleted: true, documentId: existing.documentId };
}

// === Edit Logs ===

export function addEditLog(
  blockId: string,
  documentId: string,
  authorType: SourceType,
  charDelta: number,
  authorName?: string
) {
  const id = nanoid();
  getDb()
    .query(
      `INSERT INTO edit_logs (id, block_id, document_id, author_type, author_name, char_delta, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
    )
    .run(id, blockId, documentId, authorType, authorName ?? null, charDelta);
}

// === Stats ===

export function getDocumentStats(documentId: string): DocumentStats {
  const blocks = listBlocks(documentId);

  let totalChars = 0;
  let humanChars = 0;
  let agentChars = 0;
  const sourceBreakdown = { human: 0, agent: 0, mixed: 0 };

  for (const block of blocks) {
    const derived = computeBlockDerived(block.attribution);
    totalChars += derived.humanChars + derived.agentChars;
    humanChars += derived.humanChars;
    agentChars += derived.agentChars;
    sourceBreakdown[derived.source]++;
  }

  // Timeline from edit_logs
  const logs = getDb()
    .query(
      `SELECT created_at as timestamp, author_type as authorType,
              SUM(char_delta) as delta
       FROM edit_logs
       WHERE document_id = ?
       GROUP BY strftime('%Y-%m-%dT%H:%M', created_at), author_type
       ORDER BY created_at`
    )
    .all(documentId) as any[];

  // Build cumulative timeline
  let cumHuman = 0;
  let cumAgent = 0;
  const timeline: { timestamp: string; humanChars: number; agentChars: number }[] = [];
  for (const log of logs) {
    if (log.authorType === "human") cumHuman += log.delta;
    else cumAgent += log.delta;
    timeline.push({
      timestamp: log.timestamp,
      humanChars: Math.max(0, cumHuman),
      agentChars: Math.max(0, cumAgent),
    });
  }

  return {
    totalBlocks: blocks.length,
    totalChars,
    humanChars,
    agentChars,
    humanPercent: totalChars > 0 ? (humanChars / totalChars) * 100 : 0,
    agentPercent: totalChars > 0 ? (agentChars / totalChars) * 100 : 0,
    sourceBreakdown,
    timeline,
  };
}
