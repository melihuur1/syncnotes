import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { NoteSummaryDto } from '@syncnotes/shared';
import {
  FilePlus2,
  FolderInput,
  LogOut as LeaveIcon,
  Menu,
  MoreHorizontal,
  Search,
  Trash2,
  Users,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Sidebar, useView } from '../components/sidebar';
import {
  Avatar,
  Button,
  DropdownContent,
  DropdownItem,
  DropdownMenu,
  DropdownSeparator,
  DropdownSub,
  DropdownSubContent,
  DropdownSubTrigger,
  DropdownTrigger,
  Input,
  RoleBadge,
  Spinner,
} from '../components/ui/primitives';
import {
  useCreateNote,
  useDeleteNote,
  useFolders,
  useLeaveNote,
  useMoveNote,
  useNotes,
} from '../hooks/queries';
import { timeAgo } from '../lib/time';
import { useCurrentUser } from '../providers/auth';

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function NoteCard({ note }: { note: NoteSummaryDto }) {
  const me = useCurrentUser();
  const folders = useFolders();
  const move = useMoveNote();
  const del = useDeleteNote();
  const leave = useLeaveNote();
  const isOwner = note.role === 'OWNER';

  return (
    <article className="group relative flex flex-col rounded-2xl border border-line bg-surface p-4 shadow-card transition hover:-translate-y-0.5 hover:border-line-strong">
      <Link
        to={`/notes/${note.id}`}
        className="absolute inset-0 rounded-2xl"
        aria-label={`Open ${note.title}`}
      />
      <div className="flex items-start justify-between gap-3">
        <h3
          className="line-clamp-2 text-[15px] font-semibold leading-snug"
          data-testid="note-card-title"
        >
          {note.title}
        </h3>
        <DropdownMenu>
          <DropdownTrigger asChild>
            <button
              className="relative z-10 -mr-1 -mt-1 rounded-md p-1 text-subtle opacity-0 transition hover:bg-surface-2 hover:text-fg focus:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
              aria-label={`Actions for ${note.title}`}
            >
              <MoreHorizontal className="size-4" />
            </button>
          </DropdownTrigger>
          <DropdownContent>
            <DropdownSub>
              <DropdownSubTrigger>
                <FolderInput className="size-4" /> Move to folder
              </DropdownSubTrigger>
              <DropdownSubContent>
                <DropdownItem
                  disabled={!note.folderId}
                  onSelect={() => move.mutate({ noteId: note.id, folderId: null })}
                >
                  No folder
                </DropdownItem>
                {folders.data?.map((f) => (
                  <DropdownItem
                    key={f.id}
                    disabled={f.id === note.folderId}
                    onSelect={() => move.mutate({ noteId: note.id, folderId: f.id })}
                  >
                    {f.name}
                  </DropdownItem>
                ))}
              </DropdownSubContent>
            </DropdownSub>
            <DropdownSeparator />
            {isOwner ? (
              <DropdownItem
                danger
                onSelect={() =>
                  confirm(`Delete "${note.title}" for everyone?`) && del.mutate(note.id)
                }
              >
                <Trash2 className="size-4" /> Delete note
              </DropdownItem>
            ) : (
              <DropdownItem danger onSelect={() => leave.mutate(note.id)}>
                <LeaveIcon className="size-4" /> Leave note
              </DropdownItem>
            )}
          </DropdownContent>
        </DropdownMenu>
      </div>
      <p className="mt-2 line-clamp-3 min-h-[3.75rem] text-[13px] leading-5 text-muted">
        {note.excerpt || <span className="italic text-subtle">Empty note</span>}
      </p>
      <div className="mt-4 flex items-center gap-2 text-xs text-subtle">
        <RoleBadge role={note.role} />
        {note.memberCount > 1 && (
          <span className="inline-flex items-center gap-1" title={`${note.memberCount} members`}>
            <Users className="size-3.5" /> {note.memberCount}
          </span>
        )}
        <span className="ml-auto">{timeAgo(note.updatedAt)}</span>
        {note.owner.id !== me.id && <Avatar name={note.owner.name} id={note.owner.id} size="sm" />}
      </div>
    </article>
  );
}

const TITLES: Record<string, string> = {
  all: 'All notes',
  owned: 'My notes',
  shared: 'Shared with me',
};

export function DashboardPage() {
  const [view] = useView();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDebounced(search.trim(), 250);
  const [mobileNav, setMobileNav] = useState(false);
  const navigate = useNavigate();
  const folders = useFolders();
  const create = useCreateNote();

  useEffect(() => {
    const next = new URLSearchParams(params);
    if (q) next.set('q', q);
    else next.delete('q');
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [q, params, setParams]);

  const filters = useMemo(
    () => ({
      scope: view.folderId ? undefined : view.scope,
      folderId: view.folderId,
      q: q || undefined,
    }),
    [view.scope, view.folderId, q],
  );
  const notes = useNotes(filters);
  const folderName = folders.data?.find((f) => f.id === view.folderId)?.name;
  const title = folderName ?? TITLES[view.scope];

  const newNote = () =>
    create.mutate(view.folderId, {
      onSuccess: (note) => navigate(`/notes/${note.id}`, { state: { fresh: true } }),
    });

  return (
    <div className="flex h-full">
      <aside className="hidden w-64 shrink-0 border-r border-line bg-surface md:block">
        <Sidebar />
      </aside>

      <DialogPrimitive.Root open={mobileNav} onOpenChange={setMobileNav}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40 md:hidden" />
          <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 w-72 border-r border-line bg-surface md:hidden">
            <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              Views and folders
            </DialogPrimitive.Description>
            <Sidebar onNavigate={() => setMobileNav(false)} />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <header className="sticky top-0 z-10 border-b border-line bg-canvas/85 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-8">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileNav(true)}
              aria-label="Open navigation"
            >
              <Menu className="size-4" />
            </Button>
            <div className="relative max-w-md flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search notes…"
                className="h-9 pl-9"
                aria-label="Search notes"
              />
            </div>
            <Button
              variant="primary"
              size="sm"
              className="ml-auto"
              onClick={newNote}
              loading={create.isPending}
            >
              <FilePlus2 className="size-4" />
              <span className="hidden sm:inline">New note</span>
            </Button>
          </div>
        </header>

        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
          <div className="mb-6 flex items-baseline justify-between gap-4">
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            {notes.data && (
              <span className="text-sm text-subtle">
                {notes.data.length} {notes.data.length === 1 ? 'note' : 'notes'}
              </span>
            )}
          </div>

          {notes.isLoading ? (
            <div className="flex justify-center py-24">
              <Spinner />
            </div>
          ) : notes.isError ? (
            <p className="rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
              Could not load notes.
            </p>
          ) : notes.data && notes.data.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="note-grid">
              {notes.data.map((note) => (
                <NoteCard key={note.id} note={note} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center rounded-2xl border border-dashed border-line-strong px-6 py-20 text-center">
              <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                <FilePlus2 className="size-5" />
              </span>
              <h2 className="mt-4 font-semibold">{q ? 'No matching notes' : 'Nothing here yet'}</h2>
              <p className="mt-1 max-w-sm text-sm text-muted">
                {q
                  ? `No note matches “${q}”.`
                  : view.scope === 'shared'
                    ? 'Notes other people share with you will show up here.'
                    : 'Create your first note and invite others to write with you in real time.'}
              </p>
              {!q && view.scope !== 'shared' && (
                <Button
                  variant="primary"
                  size="sm"
                  className="mt-6"
                  onClick={newNote}
                  loading={create.isPending}
                >
                  New note
                </Button>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
