import { canEdit, type NoteDetailDto } from '@syncnotes/shared';
import { ArrowLeft, Eye, History, Share2, ShieldOff } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { ConnectionStatus } from '../collab/connection-status';
import { PresenceAvatars, usePresence } from '../collab/presence';
import { type AccessState, useCollaboration } from '../collab/use-collaboration';
import { HistoryPanel } from '../components/history-panel';
import { ShareDialog } from '../components/share-dialog';
import { ThemeToggle } from '../components/theme-toggle';
import { Button, RoleBadge, Spinner } from '../components/ui/primitives';
import { CollaborativeEditor } from '../editor/collaborative-editor';
import { useNote } from '../hooks/queries';
import { isApiError } from '../lib/api';
import { useCurrentUser } from '../providers/auth';

const ACCESS_MESSAGES: Record<Exclude<AccessState, 'ok'>, { title: string; text: string }> = {
  revoked: {
    title: 'Your access was removed',
    text: 'The owner removed you from this note. Your local copy has been cleared.',
  },
  deleted: { title: 'This note was deleted', text: 'The owner deleted this note for everyone.' },
  denied: { title: 'No access', text: 'You do not have access to this note anymore.' },
};

function CenteredMessage({ title, text }: { title: string; text: string }) {
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center"
      data-testid="access-message"
    >
      <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-danger/10 text-danger">
        <ShieldOff className="size-5" />
      </span>
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="max-w-sm text-sm text-muted">{text}</p>
      <Link to="/" className="mt-2 text-sm font-medium text-accent hover:underline">
        Back to your notes
      </Link>
    </div>
  );
}

function NoteWorkspace({ note }: { note: NoteDetailDto }) {
  const user = useCurrentUser();
  const location = useLocation();
  const collab = useCollaboration({ noteId: note.id, user, initialRole: note.role });
  const presence = usePresence(collab.session?.provider, user.id);
  const [shareOpen, setShareOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const editable = canEdit(collab.role) && collab.access === 'ok';

  if (collab.access !== 'ok') return <CenteredMessage {...ACCESS_MESSAGES[collab.access]} />;

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface/80 px-3 backdrop-blur sm:px-5">
        <Link
          to="/"
          className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"
          aria-label="Back to notes"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <RoleBadge role={collab.role} className="hidden sm:inline-flex" />
        <ConnectionStatus
          phase={collab.status.phase}
          unsyncedChanges={collab.status.unsyncedChanges}
        />
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <PresenceAvatars users={presence} />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShareOpen(true)}
            data-testid="share-button"
          >
            <Share2 className="size-4" />
            <span className="hidden sm:inline">Share</span>
          </Button>
          <Button
            variant={historyOpen ? 'primary' : 'ghost'}
            size="icon"
            onClick={() => setHistoryOpen((v) => !v)}
            aria-label="Version history"
            title="Version history"
            data-testid="history-button"
          >
            <History className="size-4" />
          </Button>
          <ThemeToggle />
        </div>
      </header>

      {!editable && (
        <div
          className="flex items-center justify-center gap-2 border-b border-line bg-surface-2 px-4 py-2 text-xs text-muted"
          data-testid="readonly-banner"
        >
          <Eye className="size-3.5" /> You are viewing this note. Only editors can make changes.
        </div>
      )}

      <div className="relative flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-5 py-10 sm:px-8">
            {collab.session ? (
              <CollaborativeEditor
                key={collab.generation}
                session={collab.session}
                user={user}
                editable={editable}
                autoFocusTitle={(location.state as { fresh?: boolean } | null)?.fresh}
              />
            ) : (
              <div className="flex justify-center py-20">
                <Spinner />
              </div>
            )}
          </div>
        </main>
        {historyOpen && (
          <HistoryPanel
            noteId={note.id}
            canEdit={editable}
            onClose={() => setHistoryOpen(false)}
            onCreate={(label) => collab.send({ type: 'version.create', label })}
            onRestore={(versionId) => collab.send({ type: 'version.restore', versionId })}
          />
        )}
      </div>

      <ShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        noteId={note.id}
        members={note.members}
        role={collab.role}
      />
    </div>
  );
}

export function NotePage() {
  const { noteId = '' } = useParams();
  const note = useNote(noteId);

  if (note.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (note.isError || !note.data) {
    const missing = isApiError(note.error, 404);
    return (
      <CenteredMessage
        title={missing ? 'Note not found' : 'Could not open this note'}
        text={
          missing
            ? 'It may have been deleted, or you do not have access.'
            : 'Check your connection and try again.'
        }
      />
    );
  }
  return <NoteWorkspace key={note.data.id} note={note.data} />;
}
