import fastDiff from "fast-diff";
import type { AttributionSpan, SourceType } from "./types";
import { spliceAttribution, createAttribution, mergeSpans } from "./attribution";

/**
 * Apply a full content replacement: compute char-level diff between old and new content,
 * update attribution accordingly.
 *
 * - Retained chars keep their original attribution
 * - Deleted chars are removed from attribution
 * - Inserted chars are attributed to `author`
 */
export function applyDiffAttribution(
  oldContent: string,
  newContent: string,
  oldAttribution: AttributionSpan[],
  author: SourceType
): { attribution: AttributionSpan[]; charDelta: number } {
  const diffs = fastDiff(oldContent, newContent);
  let attribution = [...oldAttribution.map((s) => ({ ...s }))];
  let pos = 0; // position in the evolving attribution array

  for (const [op, text] of diffs) {
    const len = text.length;
    if (op === fastDiff.EQUAL) {
      pos += len;
    } else if (op === fastDiff.DELETE) {
      attribution = spliceAttribution(attribution, pos, len, []);
      // pos stays the same since chars were removed
    } else if (op === fastDiff.INSERT) {
      attribution = spliceAttribution(
        attribution,
        pos,
        0,
        createAttribution(author, len)
      );
      pos += len;
    }
  }

  return {
    attribution: mergeSpans(attribution),
    charDelta: newContent.length - oldContent.length,
  };
}

/**
 * Apply a patch (old→new substring replacement) to content and attribution.
 * Returns null if `old` is not found in content (caller should return 409).
 */
export function applyPatchAttribution(
  content: string,
  oldStr: string,
  newStr: string,
  attribution: AttributionSpan[],
  author: SourceType
): {
  content: string;
  attribution: AttributionSpan[];
  charDelta: number;
} | null {
  const start = content.indexOf(oldStr);
  if (start === -1) return null;

  const newContent =
    content.slice(0, start) + newStr + content.slice(start + oldStr.length);

  const newAttribution = spliceAttribution(
    attribution,
    start,
    oldStr.length,
    createAttribution(author, newStr.length)
  );

  return {
    content: newContent,
    attribution: mergeSpans(newAttribution),
    charDelta: newStr.length - oldStr.length,
  };
}
