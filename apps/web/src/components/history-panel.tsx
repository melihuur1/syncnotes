import type { VersionSummaryDto } from '@syncnotes/shared';
import { YDOC_FIELDS } from '@syncnotes/shared';
import { useQuery } from '@tanstack/react-query';
import Collaboration from '@tiptap/extension-collaboration';
import { EditorContent, useEditor } from '@tiptap/react';
import { Bookmark, Clock, History, RotateCcw, Save, X } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import * as Y from 'yjs';
import { contentExtensions } from '../editor/extensions';
import { useVersions } from '../hooks/queries';
import { api } from '../lib/api';
import { formatDateTime, timeAgo } from '../lib/time';
import { Button, Dialog, Input, Spinner } from './ui/primitives';

const KIND_META = {
  MANUAL: { icon: Bookmark, label: 'Saved version' },
  AUTO: { icon: Clock, label: 'Autosave' },
  RESTORE: { icon: RotateCcw, label: 'Before restore' },
} as const;

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Renders a snapshot with the exact same schema as the live editor (read-only). */
function VersionPreview({ state }: { state: string }) {
  const doc = useMemo(() => {
    const d = new Y.Doc();
    Y.applyUpdate(d, base64ToBytes(state));
    return d;
  }, [state]);
  const editor = useEditor(
    {
      editable: false,
      extensions: [
        ...contentExtensions(),
        Collaboration.configure({ document: doc, field: YDOC_FIELDS.content }),
      ],
      editorProps: { attributes: { class: 'tiptap !min-h-0' } },
    },
    [doc],
  );
  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <h2 className="mb-3 text-2xl font-bold tracking-tight">
        {doc.getText(YDOC_FIELDS.title).toString() || 'Untitled'}
      </h2>
      <EditorContent editor={editor} />
    </div>
  );
}

function VersionDialog({
  noteId,
  version,
  canRestore,
  onClose,
  onRestore,
}: {
  noteId: string;
  version: VersionSummaryDto;
  canRestore: boolean;
  onClose: () => void;
  onRestore: () => void;
}) {
  const detail = useQuery({
    queryKey: ['version', noteId, version.id],
    queryFn: () => api.versions.get(noteId, version.id),
    staleTime: Infinity,
  });
  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={version.label ?? KIND_META[version.kind].label}
      description={`${formatDateTime(version.createdAt)}${version.createdBy ? ` · ${version.createdBy.name}` : ''}`}
    >
      {detail.data ? <VersionPreview state={detail.data.state} /> : <Spinner />}
      {canRestore && (
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={onRestore} data-testid="restore-version">
            <RotateCcw className="size-4" /> Restore this version
          </Button>
        </div>
      )}
    </Dialog>
  );
}

export function HistoryPanel({
  noteId,
  canEdit,
  onClose,
  onCreate,
  onRestore,
}: {
  noteId: string;
  canEdit: boolean;
  onClose: () => void;
  onCreate: (label?: string) => void;
  onRestore: (versionId: string) => void;
}) {
  const versions = useVersions(noteId);
  const [label, setLabel] = useState('');
  const [selected, setSelected] = useState<VersionSummaryDto | null>(null);

  const save = (e: FormEvent) => {
    e.preventDefault();
    onCreate(label.trim() || undefined);
    setLabel('');
  };

  return (
    <aside
      className="flex w-full max-w-sm shrink-0 flex-col border-l border-line bg-surface max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-20 max-lg:shadow-pop"
      aria-label="Version history"
    >
      <div className="flex h-12 items-center justify-between border-b border-line px-4">
        <span className="inline-flex items-center gap-2 text-sm font-semibold">
          <History className="size-4" /> Version history
        </span>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close history">
          <X className="size-4" />
        </Button>
      </div>

      {canEdit && (
        <form onSubmit={save} className="flex gap-2 border-b border-line p-3">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Version name (optional)"
            maxLength={80}
            className="h-9"
            aria-label="Version name"
          />
          <Button
            type="submit"
            size="sm"
            variant="primary"
            className="h-9"
            data-testid="save-version"
          >
            <Save className="size-4" /> Save
          </Button>
        </form>
      )}

      <div className="flex-1 overflow-y-auto p-2">
        {versions.isLoading && (
          <div className="flex justify-center p-6">
            <Spinner />
          </div>
        )}
        {versions.data?.length === 0 && (
          <p className="p-6 text-center text-sm text-subtle">
            No versions yet. {canEdit ? 'Save one to be able to come back to this moment.' : ''}
          </p>
        )}
        <ul className="space-y-0.5">
          {versions.data?.map((v) => {
            const meta = KIND_META[v.kind];
            return (
              <li key={v.id}>
                <button
                  onClick={() => setSelected(v)}
                  className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-surface-2"
                  data-testid="version-item"
                >
                  <meta.icon className="mt-0.5 size-4 shrink-0 text-subtle" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {v.label ?? meta.label}
                    </span>
                    <span className="block text-xs text-subtle">
                      {timeAgo(v.createdAt)}
                      {v.createdBy ? ` · ${v.createdBy.name}` : ''}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {selected && (
        <VersionDialog
          noteId={noteId}
          version={selected}
          canRestore={canEdit}
          onClose={() => setSelected(null)}
          onRestore={() => {
            onRestore(selected.id);
            setSelected(null);
          }}
        />
      )}
    </aside>
  );
}
