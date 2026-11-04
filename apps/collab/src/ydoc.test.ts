import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  applyContentReplacement,
  encodeContentSnapshot,
  excerptOf,
  extractPlainText,
  extractTitle,
} from './ydoc';

function paragraph(text: string, marks?: Record<string, unknown>): Y.XmlElement {
  const p = new Y.XmlElement('paragraph');
  const t = new Y.XmlText();
  t.insert(0, text, marks);
  p.insert(0, [t]);
  return p;
}

function docWith(title: string, ...paragraphs: Y.XmlElement[]): Y.Doc {
  const doc = new Y.Doc();
  doc.getText('title').insert(0, title);
  doc.getXmlFragment('default').insert(0, paragraphs);
  return doc;
}

function bodyXml(doc: Y.Doc): string {
  return doc.getXmlFragment('default').toString();
}

describe('text extraction', () => {
  it('extracts a normalised title and one line per block', () => {
    const list = new Y.XmlElement('bulletList');
    const item = new Y.XmlElement('listItem');
    item.insert(0, [paragraph('nested item')]);
    list.insert(0, [item]);
    const doc = docWith('  Weekly   sync ', paragraph('Hello '), paragraph('bold', { bold: true }));
    doc.getXmlFragment('default').push([list]);

    expect(extractTitle(doc)).toBe('Weekly sync');
    expect(extractPlainText(doc)).toBe('Hello \nbold\nnested item');
    expect(excerptOf('a\n\n b   c')).toBe('a b c');
  });
});

describe('content snapshots', () => {
  it('round-trips content (with formatting) independent of CRDT history', () => {
    const doc = docWith('Plan', paragraph('first'), paragraph('important', { bold: true }));
    // Create some history that a snapshot should not carry along.
    doc.getXmlFragment('default').delete(0, 1);
    doc.getXmlFragment('default').insert(0, [paragraph('rewritten')]);

    const snapshot = encodeContentSnapshot(doc);
    const restored = new Y.Doc();
    Y.applyUpdate(restored, snapshot);
    expect(bodyXml(restored)).toEqual(bodyXml(doc));
    expect(restored.getText('title').toString()).toBe('Plan');
    expect(snapshot.byteLength).toBeLessThan(Y.encodeStateAsUpdate(doc).byteLength);
  });

  it('restores as a forward edit that converges on every replica', () => {
    const v1 = docWith('Draft', paragraph('version one'));
    const snapshot = encodeContentSnapshot(v1);

    // Two replicas of the live document diverge from v1.
    const a = new Y.Doc();
    const b = new Y.Doc();
    Y.applyUpdate(a, Y.encodeStateAsUpdate(v1));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    a.getXmlFragment('default').push([paragraph('later edit')]);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    // Restore on replica A, then sync to B like the server would.
    const before = Y.encodeStateVector(b);
    applyContentReplacement(a, snapshot, 'restore');
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a, before));

    for (const replica of [a, b]) {
      expect(bodyXml(replica)).toBe(bodyXml(v1));
      expect(replica.getText('title').toString()).toBe('Draft');
    }
  });
});
