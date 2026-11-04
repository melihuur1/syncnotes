import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { applyTextDiff, transformIndex } from './ytext';

function text(initial = ''): Y.Text {
  const doc = new Y.Doc();
  const t = doc.getText('title');
  t.insert(0, initial);
  return t;
}

describe('applyTextDiff', () => {
  it.each([
    ['', 'Hello'],
    ['Hello', 'Hello world'],
    ['Hello world', 'Hello'],
    ['Hello world', 'Help world'],
    ['abc', ''],
    ['same', 'same'],
  ])('turns %j into %j', (from, to) => {
    const t = text(from);
    applyTextDiff(t, to);
    expect(t.toString()).toBe(to);
  });

  it('produces minimal edits so concurrent edits from others survive', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    a.getText('t').insert(0, 'Project plan');
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    // A edits the end of the title through the input, B concurrently prefixes it.
    applyTextDiff(a.getText('t'), 'Project plan v2');
    b.getText('t').insert(0, '[Draft] ');

    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(a.getText('t').toString()).toBe('[Draft] Project plan v2');
    expect(b.getText('t').toString()).toBe(a.getText('t').toString());
  });
});

describe('transformIndex', () => {
  it('moves the caret right for remote inserts before it', () => {
    expect(transformIndex(5, [{ insert: 'abc' }])).toBe(8);
    expect(transformIndex(5, [{ retain: 2 }, { insert: 'x' }])).toBe(6);
  });

  it('keeps the caret for remote inserts at or after it', () => {
    expect(transformIndex(5, [{ retain: 5 }, { insert: 'x' }])).toBe(5);
    expect(transformIndex(2, [{ retain: 4 }, { insert: 'x' }])).toBe(2);
  });

  it('moves the caret left for remote deletes before it, clamped to the delete start', () => {
    expect(transformIndex(5, [{ delete: 2 }])).toBe(3);
    expect(transformIndex(5, [{ retain: 3 }, { delete: 10 }])).toBe(3);
    expect(transformIndex(1, [{ retain: 3 }, { delete: 2 }])).toBe(1);
  });
});
