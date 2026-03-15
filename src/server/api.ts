import { Hono } from "hono";
import * as db from "./db";
import { broadcast, createSSEResponse } from "./sse";
import { createAttribution, computeBlockDerived, concatAttribution } from "../core/attribution";
import { applyDiffAttribution, applyPatchAttribution } from "../core/diff";
import type { AttributionSpan, SourceType, Block } from "../core/types";

export const api = new Hono();

// Helper to enrich block with derived data
function enrichBlock(block: Block) {
  return { ...block, ...computeBlockDerived(block.attribution) };
}

// === Documents ===

api.get("/documents", (c) => {
  return c.json(db.listDocuments());
});

api.post("/documents", async (c) => {
  const { title } = await c.req.json<{ title: string }>();
  if (!title) return c.json({ error: "title is required" }, 400);
  const doc = db.createDocument(title);
  return c.json(doc, 201);
});

api.get("/documents/:id", (c) => {
  const doc = db.getDocument(c.req.param("id"));
  if (!doc) return c.json({ error: "Document not found" }, 404);
  const blocks = db.listBlocks(doc.id).map(enrichBlock);
  const stats = db.getDocumentStats(doc.id);
  return c.json({ ...doc, blocks, stats });
});

api.delete("/documents/:id", (c) => {
  const ok = db.deleteDocument(c.req.param("id"));
  if (!ok) return c.json({ error: "Document not found" }, 404);
  return c.body(null, 204);
});

// === Blocks ===

api.get("/documents/:id/blocks", (c) => {
  const blocks = db.listBlocks(c.req.param("id")).map(enrichBlock);
  return c.json(blocks);
});

api.post("/documents/:id/blocks", async (c) => {
  const docId = c.req.param("id");
  const doc = db.getDocument(docId);
  if (!doc) return c.json({ error: "Document not found" }, 404);

  const { content, author, position } = await c.req.json();
  if (!author?.type) return c.json({ error: "author.type is required" }, 400);

  const attribution = createAttribution(author.type, content?.length ?? 0);
  const block = db.createBlock(docId, content ?? "", attribution, author.type, position);

  if (content?.length) {
    db.addEditLog(block.id, docId, author.type, content.length, author.name);
  }

  const enriched = enrichBlock(block);
  broadcast(docId, "block_created", enriched);
  broadcast(docId, "stats_changed", db.getDocumentStats(docId));

  return c.json(enriched, 201);
});

api.put("/documents/:id/blocks/:bid", async (c) => {
  const blockId = c.req.param("bid");
  const { content, author, version } = await c.req.json();

  if (!author?.type) return c.json({ error: "author.type is required" }, 400);
  if (version === undefined) return c.json({ error: "version is required" }, 400);

  const existing = db.getBlock(blockId);
  if (!existing) return c.json({ error: "Block not found" }, 404);

  // Compute diff-based attribution
  const { attribution, charDelta } = applyDiffAttribution(
    existing.content,
    content,
    existing.attribution,
    author.type
  );

  const result = db.updateBlock(blockId, content, attribution, author.type, version);
  if ("conflict" in result) {
    return c.json(
      { error: "Version conflict", currentContent: result.block.content, currentVersion: result.block.version },
      409
    );
  }

  db.addEditLog(blockId, existing.documentId, author.type, charDelta, author.name);

  const enriched = enrichBlock(result.block);
  broadcast(existing.documentId, "block_updated", enriched);
  broadcast(existing.documentId, "stats_changed", db.getDocumentStats(existing.documentId));

  return c.json(enriched);
});

api.patch("/documents/:id/blocks/:bid", async (c) => {
  const blockId = c.req.param("bid");
  const body = await c.req.json();
  const { old: oldStr, new: newStr, author, version } = body;

  if (!author?.type) return c.json({ error: "author.type is required" }, 400);
  if (version === undefined) return c.json({ error: "version is required" }, 400);

  const existing = db.getBlock(blockId);
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

  const result = db.updateBlock(
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

  db.addEditLog(blockId, existing.documentId, author.type, patchResult.charDelta, author.name);

  const enriched = enrichBlock(result.block);
  broadcast(existing.documentId, "block_updated", enriched);
  broadcast(existing.documentId, "stats_changed", db.getDocumentStats(existing.documentId));

  return c.json(enriched);
});

api.delete("/documents/:id/blocks/:bid", async (c) => {
  const blockId = c.req.param("bid");
  const { version } = await c.req.json();

  if (version === undefined) return c.json({ error: "version is required" }, 400);

  const result = db.deleteBlock(blockId, version);
  if ("conflict" in result) {
    return c.json(
      { error: "Version conflict", currentContent: result.block.content, currentVersion: result.block.version },
      409
    );
  }

  broadcast(result.documentId, "block_deleted", { id: blockId });
  broadcast(result.documentId, "stats_changed", db.getDocumentStats(result.documentId));

  return c.body(null, 204);
});

// === Split / Merge ===

api.post("/documents/:id/blocks/:bid/split", async (c) => {
  const blockId = c.req.param("bid");
  const docId = c.req.param("id");
  const { position, version } = await c.req.json();

  if (position === undefined) return c.json({ error: "position is required" }, 400);
  if (version === undefined) return c.json({ error: "version is required" }, 400);

  const result = db.splitBlock(blockId, position, version);
  if ("conflict" in result) {
    return c.json(
      { error: "Version conflict", currentContent: result.block.content, currentVersion: result.block.version },
      409
    );
  }

  const enrichedOriginal = enrichBlock(result.original);
  const enrichedNew = enrichBlock(result.new_);

  broadcast(docId, "block_updated", enrichedOriginal);
  broadcast(docId, "block_created", enrichedNew);
  broadcast(docId, "stats_changed", db.getDocumentStats(docId));

  return c.json({ original: enrichedOriginal, new: enrichedNew });
});

api.post("/documents/:id/blocks/:bid/merge", async (c) => {
  const sourceId = c.req.param("bid");
  const docId = c.req.param("id");
  const { targetBlockId, version, targetVersion, author } = await c.req.json();

  if (!targetBlockId) return c.json({ error: "targetBlockId is required" }, 400);
  if (version === undefined) return c.json({ error: "version is required" }, 400);
  if (targetVersion === undefined) return c.json({ error: "targetVersion is required" }, 400);

  const authorType = author?.type ?? "human";
  const result = db.mergeBlocks(sourceId, targetBlockId, version, targetVersion, authorType);
  if ("conflict" in result) {
    return c.json(
      { error: "Version conflict", which: result.which, currentVersion: result.block.version },
      409
    );
  }

  const enrichedMerged = enrichBlock(result.merged);

  db.addEditLog(targetBlockId, docId, authorType, 0, author?.name);

  broadcast(docId, "block_updated", enrichedMerged);
  broadcast(docId, "block_deleted", { id: sourceId });
  broadcast(docId, "stats_changed", db.getDocumentStats(docId));

  return c.json({ merged: enrichedMerged });
});

// === Stats ===

api.get("/documents/:id/stats", (c) => {
  const docId = c.req.param("id");
  const doc = db.getDocument(docId);
  if (!doc) return c.json({ error: "Document not found" }, 404);
  return c.json(db.getDocumentStats(docId));
});

// === Export ===

api.get("/documents/:id/export", (c) => {
  const docId = c.req.param("id");
  const format = c.req.query("format") ?? "md";
  const doc = db.getDocument(docId);
  if (!doc) return c.json({ error: "Document not found" }, 404);

  const blocks = db.listBlocks(docId);
  const markdown = blocks.map((b) => b.content).join("\n\n");

  if (format === "md") {
    return c.text(markdown);
  }

  const stats = db.getDocumentStats(docId);
  const provenance = {
    version: 1,
    documentId: docId,
    title: doc.title,
    blocks: blocks.map((b) => ({
      id: b.id,
      position: b.position,
      attribution: b.attribution,
      lastSource: b.lastSource,
    })),
    stats: {
      totalChars: stats.totalChars,
      humanChars: stats.humanChars,
      agentChars: stats.agentChars,
      humanPercent: stats.humanPercent,
      agentPercent: stats.agentPercent,
    },
    exportedAt: new Date().toISOString(),
  };

  return c.json({ markdown, provenance });
});

// === Import ===

api.post("/documents/import", async (c) => {
  const { markdown, provenance, defaultSource } = await c.req.json();

  if (!markdown && !provenance) {
    return c.json({ error: "markdown or provenance is required" }, 400);
  }

  const title = provenance?.title ?? "Imported Document";
  const doc = db.createDocument(title);

  if (provenance) {
    // Full restore with provenance
    const contentBlocks = markdown.split(/\n\n/);
    for (let i = 0; i < provenance.blocks.length && i < contentBlocks.length; i++) {
      const pb = provenance.blocks[i];
      db.createBlock(
        doc.id,
        contentBlocks[i],
        pb.attribution,
        pb.lastSource,
        pb.position
      );
    }
  } else {
    // No provenance: split by double newline, mark all as defaultSource
    const source: SourceType = defaultSource ?? "human";
    const paragraphs = splitMarkdownBlocks(markdown);
    for (let i = 0; i < paragraphs.length; i++) {
      const content = paragraphs[i];
      const attribution = createAttribution(source, content.length);
      db.createBlock(doc.id, content, attribution, source, i + 1);
    }
  }

  const blocks = db.listBlocks(doc.id).map(enrichBlock);
  const stats = db.getDocumentStats(doc.id);
  return c.json({ ...doc, blocks, stats }, 201);
});

/** Split markdown into semantic blocks (respecting code blocks, etc.) */
function splitMarkdownBlocks(markdown: string): string[] {
  const lines = markdown.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        // End of code block
        current.push(line);
        blocks.push(current.join("\n"));
        current = [];
        inCodeBlock = false;
      } else {
        // Start of code block - flush current
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
      // Double newline: paragraph break
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

api.get("/documents/:id/events", (c) => {
  const docId = c.req.param("id");
  try {
    const doc = db.getDocument(docId);
    if (!doc) return c.json({ error: "Document not found" }, 404);
    return createSSEResponse(docId);
  } catch {
    return c.json({ error: "SSE connection failed" }, 503);
  }
});
