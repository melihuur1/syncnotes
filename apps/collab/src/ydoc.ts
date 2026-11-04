import { YDOC_FIELDS } from '@syncnotes/shared';
import * as Y from 'yjs';

export const MAX_TITLE_LENGTH = 200;
export const MAX_PLAIN_TEXT_LENGTH = 100_000;
export const EXCERPT_LENGTH = 200;

function xmlTextToString(text: Y.XmlText): string {
  return (text.toDelta() as Array<{ insert: unknown }>)
    .map((op) => (typeof op.insert === 'string' ? op.insert : ''))
    .join('');
}

/** Collect one line per block of a ProseMirror-shaped Y.XmlFragment. */
function collectLines(node: Y.XmlFragment | Y.XmlElement, out: string[]): void {
  let line = '';
  for (const child of node.toArray()) {
    if (child instanceof Y.XmlText) {
      line += xmlTextToString(child);
    } else if (child instanceof Y.XmlElement) {
      if (line) out.push(line);
      line = '';
      collectLines(child, out);
    }
  }
  if (line) out.push(line);
}

export function extractTitle(doc: Y.Doc): string {
  return doc
    .getText(YDOC_FIELDS.title)
    .toString()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TITLE_LENGTH);
}

export function extractPlainText(doc: Y.Doc): string {
  const lines: string[] = [];
  collectLines(doc.getXmlFragment(YDOC_FIELDS.content), lines);
  return lines.join('\n').slice(0, MAX_PLAIN_TEXT_LENGTH);
}

export function excerptOf(plainText: string): string {
  return plainText.replace(/\s+/g, ' ').trim().slice(0, EXCERPT_LENGTH);
}

/**
 * A history-free copy of the document's *content* (title + body), encoded as a Yjs update.
 * Used for version snapshots: smaller than the full CRDT state and independent of tombstones.
 */
export function encodeContentSnapshot(source: Y.Doc): Uint8Array {
  const snapshot = new Y.Doc();
  snapshot.transact(() => {
    const body = source.getXmlFragment(YDOC_FIELDS.content).toArray();
    snapshot.getXmlFragment(YDOC_FIELDS.content).insert(
      0,
      body.map((node) => (node as Y.XmlElement | Y.XmlText).clone()),
    );
    snapshot.getText(YDOC_FIELDS.title).insert(0, source.getText(YDOC_FIELDS.title).toString());
  });
  const update = Y.encodeStateAsUpdate(snapshot);
  snapshot.destroy();
  return update;
}

/**
 * Replaces the live document's content with the content of `snapshotUpdate` as a *forward*
 * CRDT edit (delete current + insert copy). Unlike overwriting the stored state, this propagates
 * to every connected and offline replica through normal Yjs sync.
 */
export function applyContentReplacement(
  target: Y.Doc,
  snapshotUpdate: Uint8Array,
  origin: unknown,
): void {
  const source = new Y.Doc();
  Y.applyUpdate(source, snapshotUpdate);
  target.transact(() => {
    const body = target.getXmlFragment(YDOC_FIELDS.content);
    if (body.length > 0) body.delete(0, body.length);
    body.insert(
      0,
      source
        .getXmlFragment(YDOC_FIELDS.content)
        .toArray()
        .map((node) => (node as Y.XmlElement | Y.XmlText).clone()),
    );
    const title = target.getText(YDOC_FIELDS.title);
    if (title.length > 0) title.delete(0, title.length);
    title.insert(0, source.getText(YDOC_FIELDS.title).toString());
  }, origin);
  source.destroy();
}
