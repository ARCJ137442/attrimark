import { nanoid } from "nanoid";
import { readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
  Block,
  AttributionSpan,
  SourceType,
  DocumentStats,
} from "../core/types";
import {
  computeBlockDerived,
  splitAttributionAt,
  concatAttribution,
  createAttribution,
} from "../core/attribution";

// === File Format Types ===

interface AttrimarkFile {
  format: "attrimark-v1";
  title: string;
  createdAt: string;
  updatedAt: string;
  blocks: AttrimarkBlock[];
  editLogs: AttrimarkEditLog[];
}

interface AttrimarkBlock {
  id: string;
  content: string;
  attribution: [string, number][]; // [source, charCount]
  lastSource: string;
  position: number;
  version: number;
}

interface AttrimarkEditLog {
  id: string;
  blockId: string;
  authorType: string;
  authorName?: string;
  charDelta: number;
  createdAt: string;
}

// === Serialization Helpers ===

/** Convert internal AttributionSpan[] to file format [source, count][] */
function attrToFile(spans: AttributionSpan[]): [string, number][] {
  return spans.map((s) => [s.s, s.n]);
}

/** Convert file format [source, count][] to internal AttributionSpan[] */
function attrFromFile(pairs: [string, number][]): AttributionSpan[] {
  return pairs.map(([s, n]) => ({ s: s as SourceType, n }));
}

/** Convert file block to internal Block (with documentId = filePath) */
function blockFromFile(fb: AttrimarkBlock, filePath: string): Block {
  return {
    id: fb.id,
    documentId: filePath,
    content: fb.content,
    attribution: attrFromFile(fb.attribution),
    lastSource: fb.lastSource as SourceType,
    position: fb.position,
    version: fb.version,
    createdAt: "", // not stored per-block in file
    updatedAt: "", // not stored per-block in file
  };
}

/** Convert internal Block to file block */
function blockToFile(block: Block): AttrimarkBlock {
  return {
    id: block.id,
    content: block.content,
    attribution: attrToFile(block.attribution),
    lastSource: block.lastSource,
    position: block.position,
    version: block.version,
  };
}

/** Serialize AttrimarkFile to stable JSON (sorted keys, 2-space indent) */
function serialize(data: AttrimarkFile): string {
  // Manually construct to ensure stable key order
  const obj = {
    format: data.format,
    title: data.title,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    blocks: data.blocks.map((b) => ({
      id: b.id,
      content: b.content,
      attribution: b.attribution,
      lastSource: b.lastSource,
      position: b.position,
      version: b.version,
    })),
    editLogs: data.editLogs.map((l) => {
      const entry: Record<string, unknown> = {
        id: l.id,
        blockId: l.blockId,
        authorType: l.authorType,
      };
      if (l.authorName) entry.authorName = l.authorName;
      entry.charDelta = l.charDelta;
      entry.createdAt = l.createdAt;
      return entry;
    }),
  };
  return JSON.stringify(obj, null, 2) + "\n";
}

// === File I/O ===

function readAttrimarkFile(filePath: string): AttrimarkFile {
  const content = readFileSync(filePath, "utf-8");
  return JSON.parse(content) as AttrimarkFile;
}

function writeAttrimarkFile(filePath: string, data: AttrimarkFile): void {
  data.updatedAt = new Date().toISOString();
  const content = serialize(data);
  const tmpPath = filePath + ".tmp";
  writeFileSync(tmpPath, content, "utf-8");
  renameSync(tmpPath, filePath);
}

// === Document Operations ===

export interface DocumentSummary {
  path: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export async function listDocuments(dir: string): Promise<DocumentSummary[]> {
  const results: DocumentSummary[] = [];
  const absDir = resolve(dir);

  async function scan(d: string) {
    const entries = await readdir(d, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(d, entry.name);
      if (entry.isDirectory()) {
        await scan(fullPath);
      } else if (entry.name.endsWith(".attrimark")) {
        try {
          const data = readAttrimarkFile(fullPath);
          results.push({
            path: fullPath,
            title: data.title,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
          });
        } catch {}
      }
    }
  }

  await scan(absDir);
  results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return results;
}

export function getDocument(filePath: string): {
  path: string;
  title: string;
  createdAt: string;
  updatedAt: string;
} | null {
  try {
    const data = readAttrimarkFile(filePath);
    return {
      path: filePath,
      title: data.title,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    };
  } catch {
    return null;
  }
}

export function createDocument(filePath: string, title: string): DocumentSummary {
  const now = new Date().toISOString();
  const data: AttrimarkFile = {
    format: "attrimark-v1",
    title,
    createdAt: now,
    updatedAt: now,
    blocks: [],
    editLogs: [],
  };
  writeAttrimarkFile(filePath, data);
  return { path: filePath, title, createdAt: now, updatedAt: now };
}

export function deleteDocument(filePath: string): boolean {
  try {
    unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

// === Block Operations ===

export function listBlocks(filePath: string): Block[] {
  const data = readAttrimarkFile(filePath);
  return data.blocks
    .sort((a, b) => a.position - b.position)
    .map((b) => blockFromFile(b, filePath));
}

export function getBlock(filePath: string, blockId: string): Block | null {
  const data = readAttrimarkFile(filePath);
  const fb = data.blocks.find((b) => b.id === blockId);
  return fb ? blockFromFile(fb, filePath) : null;
}

export function createBlock(
  filePath: string,
  content: string,
  attribution: AttributionSpan[],
  lastSource: SourceType,
  position?: number
): Block {
  const data = readAttrimarkFile(filePath);
  const id = nanoid();

  if (position === undefined) {
    const maxPos = data.blocks.reduce((m, b) => Math.max(m, b.position), 0);
    position = maxPos + 1;
  }

  const fb: AttrimarkBlock = {
    id,
    content,
    attribution: attrToFile(attribution),
    lastSource,
    position,
    version: 1,
  };

  data.blocks.push(fb);
  writeAttrimarkFile(filePath, data);

  return blockFromFile(fb, filePath);
}

export interface UpdateBlockResult {
  block: Block;
  charDelta: number;
}

export function updateBlock(
  filePath: string,
  blockId: string,
  content: string,
  attribution: AttributionSpan[],
  lastSource: SourceType,
  expectedVersion: number
): UpdateBlockResult | { conflict: true; block: Block } {
  const data = readAttrimarkFile(filePath);
  const idx = data.blocks.findIndex((b) => b.id === blockId);
  if (idx === -1) throw new Error("Block not found");

  const existing = data.blocks[idx];
  if (existing.version !== expectedVersion) {
    return { conflict: true, block: blockFromFile(existing, filePath) };
  }

  const charDelta = content.length - existing.content.length;
  existing.content = content;
  existing.attribution = attrToFile(attribution);
  existing.lastSource = lastSource;
  existing.version += 1;

  writeAttrimarkFile(filePath, data);

  return { block: blockFromFile(existing, filePath), charDelta };
}

export function deleteBlock(
  filePath: string,
  blockId: string,
  expectedVersion: number
): { deleted: true; documentId: string } | { conflict: true; block: Block } {
  const data = readAttrimarkFile(filePath);
  const idx = data.blocks.findIndex((b) => b.id === blockId);
  if (idx === -1) throw new Error("Block not found");

  const existing = data.blocks[idx];
  if (existing.version !== expectedVersion) {
    return { conflict: true, block: blockFromFile(existing, filePath) };
  }

  data.blocks.splice(idx, 1);
  writeAttrimarkFile(filePath, data);

  return { deleted: true, documentId: filePath };
}

// === Split / Merge ===

export function splitBlock(
  filePath: string,
  blockId: string,
  position: number,
  expectedVersion: number
): { original: Block; new_: Block } | { conflict: true; block: Block } {
  const data = readAttrimarkFile(filePath);
  const idx = data.blocks.findIndex((b) => b.id === blockId);
  if (idx === -1) throw new Error("Block not found");

  const existing = data.blocks[idx];
  if (existing.version !== expectedVersion) {
    return { conflict: true, block: blockFromFile(existing, filePath) };
  }

  const existingAttr = attrFromFile(existing.attribution);
  const [leftAttr, rightAttr] = splitAttributionAt(existingAttr, position);
  const leftContent = existing.content.slice(0, position);
  const rightContent = existing.content.slice(position);

  // Update original
  existing.content = leftContent;
  existing.attribution = attrToFile(leftAttr);
  existing.version += 1;

  // Create new block
  const newId = nanoid();
  const newFb: AttrimarkBlock = {
    id: newId,
    content: rightContent,
    attribution: attrToFile(rightAttr),
    lastSource: existing.lastSource,
    position: existing.position + 0.5,
    version: 1,
  };

  // Insert after original
  data.blocks.splice(idx + 1, 0, newFb);
  writeAttrimarkFile(filePath, data);

  return {
    original: blockFromFile(existing, filePath),
    new_: blockFromFile(newFb, filePath),
  };
}

export function mergeBlocks(
  filePath: string,
  sourceId: string,
  targetId: string,
  sourceVersion: number,
  targetVersion: number,
  authorType: SourceType
): { merged: Block } | { conflict: true; block: Block; which: "source" | "target" } {
  const data = readAttrimarkFile(filePath);
  const sourceIdx = data.blocks.findIndex((b) => b.id === sourceId);
  const targetIdx = data.blocks.findIndex((b) => b.id === targetId);
  if (sourceIdx === -1) throw new Error("Source block not found");
  if (targetIdx === -1) throw new Error("Target block not found");

  const source = data.blocks[sourceIdx];
  const target = data.blocks[targetIdx];

  if (source.version !== sourceVersion) {
    return { conflict: true, block: blockFromFile(source, filePath), which: "source" };
  }
  if (target.version !== targetVersion) {
    return { conflict: true, block: blockFromFile(target, filePath), which: "target" };
  }

  const separator = "\n\n";
  const mergedContent = target.content + separator + source.content;
  const separatorAttr = createAttribution(authorType, separator.length);
  const mergedAttribution = concatAttribution(
    concatAttribution(attrFromFile(target.attribution), separatorAttr),
    attrFromFile(source.attribution)
  );

  target.content = mergedContent;
  target.attribution = attrToFile(mergedAttribution);
  target.lastSource = authorType;
  target.version += 1;

  // Remove source
  data.blocks.splice(sourceIdx, 1);
  writeAttrimarkFile(filePath, data);

  return { merged: blockFromFile(target, filePath) };
}

// === Edit Logs ===

export function addEditLog(
  filePath: string,
  blockId: string,
  authorType: SourceType,
  charDelta: number,
  authorName?: string
) {
  const data = readAttrimarkFile(filePath);
  const log: AttrimarkEditLog = {
    id: nanoid(),
    blockId,
    authorType,
    charDelta,
    createdAt: new Date().toISOString(),
  };
  if (authorName) log.authorName = authorName;
  data.editLogs.push(log);
  writeAttrimarkFile(filePath, data);
}

// === Stats ===

export function getDocumentStats(filePath: string): DocumentStats {
  const data = readAttrimarkFile(filePath);
  const blocks = data.blocks.map((b) => blockFromFile(b, filePath));

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
  const logsByMinute = new Map<string, { human: number; agent: number }>();
  for (const log of data.editLogs) {
    const minute = log.createdAt.slice(0, 16); // YYYY-MM-DDTHH:MM
    const entry = logsByMinute.get(minute) ?? { human: 0, agent: 0 };
    if (log.authorType === "human") entry.human += log.charDelta;
    else entry.agent += log.charDelta;
    logsByMinute.set(minute, entry);
  }

  let cumHuman = 0;
  let cumAgent = 0;
  const timeline: { timestamp: string; humanChars: number; agentChars: number }[] = [];
  const sortedMinutes = [...logsByMinute.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [timestamp, deltas] of sortedMinutes) {
    cumHuman += deltas.human;
    cumAgent += deltas.agent;
    timeline.push({
      timestamp,
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
