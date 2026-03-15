import type { AttributionSpan, BlockDerived, SourceType } from "./types";

/** Merge adjacent spans with the same source (RLE compression) */
export function mergeSpans(spans: AttributionSpan[]): AttributionSpan[] {
  if (spans.length === 0) return [];
  const result: AttributionSpan[] = [{ ...spans[0] }];
  for (let i = 1; i < spans.length; i++) {
    const last = result[result.length - 1];
    if (spans[i].s === last.s) {
      last.n += spans[i].n;
    } else if (spans[i].n > 0) {
      result.push({ ...spans[i] });
    }
  }
  return result.filter((s) => s.n > 0);
}

/** Create attribution for a new string of given length */
export function createAttribution(
  source: SourceType,
  length: number
): AttributionSpan[] {
  if (length === 0) return [];
  return [{ s: source, n: length }];
}

/** Splice attribution: remove `deleteCount` chars at `start`, insert `inserted` spans */
export function spliceAttribution(
  spans: AttributionSpan[],
  start: number,
  deleteCount: number,
  inserted: AttributionSpan[]
): AttributionSpan[] {
  // Expand to per-char array for simplicity, then re-compress
  // For large docs this could be optimized, but for MVP this is clear and correct
  const chars = expandSpans(spans);
  const insertedChars = expandSpans(inserted);
  chars.splice(start, deleteCount, ...insertedChars);
  return compressChars(chars);
}

/** Expand RLE spans to per-character source array */
function expandSpans(spans: AttributionSpan[]): SourceType[] {
  const result: SourceType[] = [];
  for (const span of spans) {
    for (let i = 0; i < span.n; i++) {
      result.push(span.s);
    }
  }
  return result;
}

/** Compress per-character source array back to RLE spans */
function compressChars(chars: SourceType[]): AttributionSpan[] {
  if (chars.length === 0) return [];
  const spans: AttributionSpan[] = [{ s: chars[0], n: 1 }];
  for (let i = 1; i < chars.length; i++) {
    const last = spans[spans.length - 1];
    if (chars[i] === last.s) {
      last.n++;
    } else {
      spans.push({ s: chars[i], n: 1 });
    }
  }
  return spans;
}

/** Compute derived stats for a block's attribution */
export function computeBlockDerived(
  attribution: AttributionSpan[]
): BlockDerived {
  let humanChars = 0;
  let agentChars = 0;
  for (const span of attribution) {
    if (span.s === "human") humanChars += span.n;
    else agentChars += span.n;
  }
  const total = humanChars + agentChars;
  const hasHuman = humanChars > 0;
  const hasAgent = agentChars > 0;
  const source =
    hasHuman && hasAgent ? "mixed" : hasAgent ? "agent" : "human";
  return {
    source,
    humanChars,
    agentChars,
    humanPercent: total > 0 ? (humanChars / total) * 100 : 0,
    agentPercent: total > 0 ? (agentChars / total) * 100 : 0,
  };
}

/** Total char count of attribution spans */
export function totalChars(spans: AttributionSpan[]): number {
  return spans.reduce((sum, s) => sum + s.n, 0);
}

/** Validate that attribution matches content length */
export function validateAttribution(
  attribution: AttributionSpan[],
  contentLength: number
): boolean {
  return totalChars(attribution) === contentLength;
}

/** Concatenate two attribution arrays (for block merge) */
export function concatAttribution(
  a: AttributionSpan[],
  b: AttributionSpan[]
): AttributionSpan[] {
  return mergeSpans([...a, ...b]);
}

/** Split attribution at a character position into two halves */
export function splitAttributionAt(
  spans: AttributionSpan[],
  position: number
): [AttributionSpan[], AttributionSpan[]] {
  const chars = expandSpans(spans);
  const left = compressChars(chars.slice(0, position));
  const right = compressChars(chars.slice(position));
  return [left, right];
}
