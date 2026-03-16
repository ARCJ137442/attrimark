import { Hono } from "hono";
import * as storage from "./storage";
import { broadcast, createSSEResponse } from "./sse";
import { createAttribution, computeBlockDerived } from "../core/attribution";
import { applyDiffAttribution, applyPatchAttribution } from "../core/diff";
import type { Block } from "../core/types";

export const api = new Hono();

// Helper to enrich block with derived data
function enrichBlock(block: Block) {
  return { ...block, ...computeBlockDerived(block.attribution) };
}

// Helper to get path from query param
function getPath(c: any): string | null {
  return c.req.query("path") ?? null;
}

// === Documents ===

api.get("/documents", async (c) => {
  const dir = c.req.query("dir") ?? process.cwd();
  const docs = await storage.listDocuments(dir);
  return c.json(docs);
});

api.post("/documents", async (c) => {
  const { title, path } = await c.req.json<{ title: string; path: string }>();
  if (!title) return c.json({ error: "title is required" }, 400);
  if (!path) return c.json({ error: "path is required" }, 400);
  const doc = storage.createDocument(path, title);
  return c.json(doc, 201);
});

api.get("/documents/detail", (c) => {
  const path = getPath(c);
  if (!path) return c.json({ error: "path is required" }, 400);
  const doc = storage.getDocument(path);
  if (!doc) return c.json({ error: "Document not found" }, 404);
  const blocks = storage.listBlocks(path).map(enrichBlock);
  const stats = storage.getDocumentStats(path);
  return c.json({ ...doc, blocks, stats });
});

api.delete("/documents", (c) => {
  const path = getPath(c);
  if (!path) return c.json({ error: "path is required" }, 400);
  const ok = storage.deleteDocument(path);
  if (!ok) return c.json({ error: "Document not found" }, 404);
  return c.body(null, 204);
});

// === Blocks ===

api.get("/blocks", (c) => {
  const path = getPath(c);
  if (!path) return c.json({ error: "path is required" }, 400);
  const blocks = storage.listBlocks(path).map(enrichBlock);
  return c.json(blocks);
});

api.post("/blocks", async (c) => {
  const path = getPath(c);
  if (!path) return c.json({ error: "path is required" }, 400);

  const { content, author, position } = await c.req.json();
  if (!author?.type) return c.json({ error: "author.type is required" }, 400);

  const attribution = createAttribution(author.type, content?.length ?? 0);
  const block = storage.createBlock(path, content ?? "", attribution, author.type, position);

  if (content?.length) {
    storage.addEditLog(path, block.id, author.type, content.length, author.name);
  }

  const enriched = enrichBlock(block);
  broadcast(path, "block_created", enriched);
  broadcast(path, "stats_changed", storage.getDocumentStats(path));

  return c.json(enriched, 201);
});

api.put("/blocks/:bid", async (c) => {
  const path = getPath(c);
  if (!path) return c.json({ error: "path is required" }, 400);
  const blockId = c.req.param("bid");
  const { content, author, version } = await c.req.json();

  if (!author?.type) return c.json({ error: "author.type is required" }, 400);
  if (version === undefined) return c.json({ error: "version is required" }, 400);

  const existing = storage.getBlock(path, blockId);
  if (!existing) return c.json({ error: "Block not found" }, 404);

  const { attribution, charDelta } = applyDiffAttribution(
    existing.content,
    content,
    existing.attribution,
    author.type
  );

  const result = storage.updateBlock(path, blockId, content, attribution, author.type, version);
  if ("conflict" in result) {
    return c.json(
      { error: "Version conflict", currentContent: result.block.content, currentVersion: result.block.version },
      409
    );
  }

  storage.addEditLog(path, blockId, author.type, charDelta, author.name);

  const enriched = enrichBlock(result.block);
  broadcast(path, "block_updated", enriched);
  broadcast(path, "stats_changed", storage.getDocumentStats(path));

  return c.json(enriched);
});

api.patch("/blocks/:bid", async (c) => {
  const path = getPath(c);
  if (!path) return c.json({ error: "path is required" }, 400);
  const blockId = c.req.param("bid");
  const body = await c.req.json();
  const { old: oldStr, new: newStr, author, version } = body;

  if (!author?.type) return c.json({ error: "author.type is required" }, 400);
  if (version === undefined) return c.json({ error: "version is required" }, 400);

  const existing = storage.getBlock(path, blockId);
  if (!existing) return c.json({ error: "Block not found" }, 404);

  if (existing.version !== version) {
    return c.json(
      { error: "Version conflict", currentContent: existing.content, currentVersion: existing.version },
      409
    );
  }

  const patchResult = applyPatchAttribution(
    existing.content,
    oldStr,
    newStr,
    existing.attribution,
    author.type
  );

  if (!patchResult) {
    return c.json(
      { error: "Old string not found in content", currentContent: existing.content, currentVersion: existing.version },
      409
    );
  }

  const result = storage.updateBlock(
    path,
    blockId,
    patchResult.content,
    patchResult.attribution,
    author.type,
    version
  );

  if ("conflict" in result) {
    return c.json(
      { error: "Version conflict", currentContent: result.block.content, currentVersion: result.block.version },
      409
    );
  }

  storage.addEditLog(path, blockId, author.type, patchResult.charDelta, author.name);

  const enriched = enrichBlock(result.block);
  broadcast(path, "block_updated", enriched);
  broadcast(path, "stats_changed", storage.getDocumentStats(path));

  return c.json(enriched);
});

api.delete("/blocks/:bid", async (c) => {
  const path = getPath(c);
  if (!path) return c.json({ error: "path is required" }, 400);
  const blockId = c.req.param("bid");
  const { version } = await c.req.json();

  if (version === undefined) return c.json({ error: "version is required" }, 400);

  const result = storage.deleteBlock(path, blockId, version);
  if ("conflict" in result) {
    return c.json(
      { error: "Version conflict", currentContent: result.block.content, currentVersion: result.block.version },
      409
    );
  }

  broadcast(path, "block_deleted", { id: blockId });
  broadcast(path, "stats_changed", storage.getDocumentStats(path));

  return c.body(null, 204);
});

// === Split / Merge ===

api.post("/blocks/:bid/split", async (c) => {
  const path = getPath(c);
  if (!path) return c.json({ error: "path is required" }, 400);
  const blockId = c.req.param("bid");
  const { position, version } = await c.req.json();

  if (position === undefined) return c.json({ error: "position is required" }, 400);
  if (version === undefined) return c.json({ error: "version is required" }, 400);

  const result = storage.splitBlock(path, blockId, position, version);
  if ("conflict" in result) {
    return c.json(
      { error: "Version conflict", currentContent: result.block.content, currentVersion: result.block.version },
      409
    );
  }

  const enrichedOriginal = enrichBlock(result.original);
  const enrichedNew = enrichBlock(result.new_);

  broadcast(path, "block_updated", enrichedOriginal);
  broadcast(path, "block_created", enrichedNew);
  broadcast(path, "stats_changed", storage.getDocumentStats(path));

  return c.json({ original: enrichedOriginal, new: enrichedNew });
});

api.post("/blocks/:bid/merge", async (c) => {
  const path = getPath(c);
  if (!path) return c.json({ error: "path is required" }, 400);
  const sourceId = c.req.param("bid");
  const { targetBlockId, version, targetVersion, author } = await c.req.json();

  if (!targetBlockId) return c.json({ error: "targetBlockId is required" }, 400);
  if (version === undefined) return c.json({ error: "version is required" }, 400);
  if (targetVersion === undefined) return c.json({ error: "targetVersion is required" }, 400);

  const authorType = author?.type ?? "human";
  const result = storage.mergeBlocks(path, sourceId, targetBlockId, version, targetVersion, authorType);
  if ("conflict" in result) {
    return c.json(
      { error: "Version conflict", which: result.which, currentVersion: result.block.version },
      409
    );
  }

  const enrichedMerged = enrichBlock(result.merged);
  storage.addEditLog(path, targetBlockId, authorType, 0, author?.name);

  broadcast(path, "block_updated", enrichedMerged);
  broadcast(path, "block_deleted", { id: sourceId });
  broadcast(path, "stats_changed", storage.getDocumentStats(path));

  return c.json({ merged: enrichedMerged });
});

// === Stats ===

api.get("/stats", (c) => {
  const path = getPath(c);
  if (!path) return c.json({ error: "path is required" }, 400);
  return c.json(storage.getDocumentStats(path));
});

// === Export ===

api.get("/export", (c) => {
  const path = getPath(c);
  if (!path) return c.json({ error: "path is required" }, 400);
  const format = c.req.query("format") ?? "md";
  const doc = storage.getDocument(path);
  if (!doc) return c.json({ error: "Document not found" }, 404);

  const blocks = storage.listBlocks(path);
  const markdown = blocks.map((b) => b.content).join("\n\n");

  if (format === "md") {
    return c.text(markdown);
  }

  // full: return the raw .attrimark file content
  const { readFileSync } = require("node:fs");
  const raw = readFileSync(path, "utf-8");
  return c.json(JSON.parse(raw));
});

// === Import ===

api.post("/import", async (c) => {
  const { markdown, path, defaultSource } = await c.req.json();

  if (!markdown) return c.json({ error: "markdown is required" }, 400);
  if (!path) return c.json({ error: "path is required" }, 400);

  const source = defaultSource ?? "human";
  const doc = storage.createDocument(path, "Imported Document");

  const paragraphs = splitMarkdownBlocks(markdown);
  for (let i = 0; i < paragraphs.length; i++) {
    const content = paragraphs[i];
    const attribution = createAttribution(source, content.length);
    storage.createBlock(path, content, attribution, source, i + 1);
  }

  const blocks = storage.listBlocks(path).map(enrichBlock);
  const stats = storage.getDocumentStats(path);
  return c.json({ ...doc, blocks, stats }, 201);
});

/** Split markdown into semantic blocks */
function splitMarkdownBlocks(markdown: string): string[] {
  const lines = markdown.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        current.push(line);
        blocks.push(current.join("\n"));
        current = [];
        inCodeBlock = false;
      } else {
        if (current.length > 0) {
          const text = current.join("\n").trim();
          if (text) blocks.push(text);
          current = [];
        }
        current.push(line);
        inCodeBlock = true;
      }
    } else if (inCodeBlock) {
      current.push(line);
    } else if (line.trim() === "" && current.length > 0 && current[current.length - 1].trim() === "") {
      const text = current.join("\n").trim();
      if (text) blocks.push(text);
      current = [];
    } else {
      current.push(line);
    }
  }

  if (current.length > 0) {
    const text = current.join("\n").trim();
    if (text) blocks.push(text);
  }

  return blocks;
}

// === SSE ===

api.get("/events", (c) => {
  const path = getPath(c);
  if (!path) return c.json({ error: "path is required" }, 400);
  const doc = storage.getDocument(path);
  if (!doc) return c.json({ error: "Document not found" }, 404);

  return createSSEResponse(path);
});
