import type { PublicUser } from '@syncnotes/shared';
import { YDOC_FIELDS } from '@syncnotes/shared';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { EditorContent, useEditor } from '@tiptap/react';
import { useEffect } from 'react';
import type { CollabSession } from '../collab/use-collaboration';
import { colorForUser } from '../lib/colors';
import { contentExtensions } from './extensions';
import { TitleInput } from './title-input';
import { Toolbar } from './toolbar';

export function CollaborativeEditor({
  session,
  user,
  editable,
  autoFocusTitle,
}: {
  session: CollabSession;
  user: PublicUser;
  editable: boolean;
  autoFocusTitle?: boolean;
}) {
  const editor = useEditor(
    {
      extensions: [
        ...contentExtensions('Start writing… Markdown shortcuts work: #, -, [ ], >, ```'),
        Collaboration.configure({ document: session.doc, field: YDOC_FIELDS.content }),
        CollaborationCaret.configure({
          provider: session.provider,
          user: { id: user.id, name: user.name, color: colorForUser(user.id) },
        }),
      ],
      editable,
      editorProps: {
        attributes: { class: 'tiptap', 'data-testid': 'editor', 'aria-label': 'Note content' },
      },
    },
    [session],
  );

  useEffect(() => {
    if (editor && editor.isEditable !== editable) editor.setEditable(editable);
  }, [editor, editable]);

  return (
    <div className="space-y-5">
      <TitleInput
        doc={session.doc}
        editable={editable}
        autoFocus={autoFocusTitle && editable}
        onEnter={() => editor?.commands.focus('start')}
      />
      {editor && editable && (
        <div className="sticky top-2 z-10">
          <Toolbar editor={editor} disabled={!editable} />
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
