import { YDOC_FIELDS } from '@syncnotes/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { applyTextDiff, transformIndex } from '../lib/ytext';

const LOCAL_ORIGIN = Symbol('title-input');

/**
 * A plain <input> bound to the shared `title` Y.Text. Local typing is applied as a minimal diff
 * (so concurrent edits merge), and remote edits move the caret like a real collaborative editor.
 */
export function TitleInput({
  doc,
  editable,
  autoFocus,
  onEnter,
}: {
  doc: Y.Doc;
  editable: boolean;
  autoFocus?: boolean;
  onEnter?: () => void;
}) {
  const ytext = useMemo(() => doc.getText(YDOC_FIELDS.title), [doc]);
  const [value, setValue] = useState(() => ytext.toString());
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValue(ytext.toString());
    const observer = (event: Y.YTextEvent, transaction: Y.Transaction) => {
      if (transaction.origin === LOCAL_ORIGIN) return;
      const input = ref.current;
      const next = ytext.toString();
      if (input && document.activeElement === input) {
        const delta = event.delta as Parameters<typeof transformIndex>[1];
        const start = transformIndex(input.selectionStart ?? 0, delta);
        const end = transformIndex(input.selectionEnd ?? 0, delta);
        setValue(next);
        requestAnimationFrame(() => input.setSelectionRange(start, end));
      } else {
        setValue(next);
      }
    };
    ytext.observe(observer);
    return () => ytext.unobserve(observer);
  }, [ytext]);

  return (
    <input
      ref={ref}
      value={value}
      readOnly={!editable}
      autoFocus={autoFocus}
      maxLength={200}
      placeholder="Untitled"
      aria-label="Note title"
      data-testid="note-title"
      onChange={(e) => {
        setValue(e.target.value);
        applyTextDiff(ytext, e.target.value, LOCAL_ORIGIN);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onEnter?.();
        }
      }}
      className="w-full bg-transparent text-3xl font-bold tracking-tight text-fg placeholder:text-subtle/60 focus:outline-none sm:text-4xl"
    />
  );
}
