import type * as Y from 'yjs';

/**
 * Applies the minimal edit (common prefix/suffix diff) that turns `ytext` into `next`.
 * Minimal edits matter for CRDTs: replacing the whole string would clobber concurrent
 * edits from other users, while a minimal edit merges with them.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin?: unknown): void {
  const prev = ytext.toString();
  if (prev === next) return;

  let start = 0;
  const maxStart = Math.min(prev.length, next.length);
  while (start < maxStart && prev.charCodeAt(start) === next.charCodeAt(start)) start++;

  let endPrev = prev.length;
  let endNext = next.length;
  while (
    endPrev > start &&
    endNext > start &&
    prev.charCodeAt(endPrev - 1) === next.charCodeAt(endNext - 1)
  ) {
    endPrev--;
    endNext--;
  }

  const doc = ytext.doc;
  const apply = () => {
    if (endPrev > start) ytext.delete(start, endPrev - start);
    if (endNext > start) ytext.insert(start, next.slice(start, endNext));
  };
  if (doc) doc.transact(apply, origin);
  else apply();
}

type DeltaOp = { insert?: string | object; delete?: number; retain?: number };

/**
 * Maps a caret index through a remote Y.Text change (its `delta`), so the local caret stays
 * next to the same characters. Remote inserts exactly at the caret do not push it forward.
 */
export function transformIndex(index: number, delta: DeltaOp[]): number {
  let oldPos = 0;
  let result = index;
  for (const op of delta) {
    if (op.retain !== undefined) {
      oldPos += op.retain;
    } else if (op.insert !== undefined) {
      const length = typeof op.insert === 'string' ? op.insert.length : 1;
      if (oldPos < index) result += length;
    } else if (op.delete !== undefined) {
      if (oldPos < index) result -= Math.min(op.delete, index - oldPos);
      oldPos += op.delete;
    }
    if (oldPos >= index && op.retain !== undefined) break;
  }
  return Math.max(0, result);
}
