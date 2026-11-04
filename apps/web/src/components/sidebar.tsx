import {
  Check,
  FileText,
  Folder,
  FolderPlus,
  Inbox,
  LogOut,
  MoreHorizontal,
  Pencil,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useFolderMutations, useFolders } from '../hooks/queries';
import { useAuth } from '../providers/auth';
import { ThemeToggle } from './theme-toggle';
import { Logo } from './ui/logo';
import {
  Avatar,
  Button,
  cn,
  DropdownContent,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
  Input,
} from './ui/primitives';

export interface View {
  scope: 'all' | 'owned' | 'shared';
  folderId?: string;
}

export function useView(): [View, (v: View) => void] {
  const [params, setParams] = useSearchParams();
  const scope = (params.get('view') as View['scope'] | null) ?? 'all';
  const view: View = {
    scope: ['all', 'owned', 'shared'].includes(scope) ? scope : 'all',
    folderId: params.get('folder') ?? undefined,
  };
  const setView = (v: View) => {
    const next = new URLSearchParams();
    if (v.scope !== 'all') next.set('view', v.scope);
    if (v.folderId) next.set('folder', v.folderId);
    const q = params.get('q');
    if (q) next.set('q', q);
    setParams(next);
  };
  return [view, setView];
}

function NavItem({
  active,
  icon: Icon,
  label,
  count,
  onClick,
}: {
  active: boolean;
  icon: typeof FileText;
  label: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13.5px] transition',
        active
          ? 'bg-accent-soft font-medium text-accent'
          : 'text-muted hover:bg-surface-2 hover:text-fg',
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{label}</span>
      {count !== undefined && (
        <span className="ml-auto text-xs tabular-nums text-subtle">{count}</span>
      )}
    </button>
  );
}

function FolderRow({
  id,
  name,
  count,
  active,
  onSelect,
}: {
  id: string;
  name: string;
  count: number;
  active: boolean;
  onSelect: () => void;
}) {
  const { rename, remove } = useFolderMutations();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next = value.trim();
    if (next && next !== name) rename.mutate({ id, name: next });
    setEditing(false);
  };

  if (editing) {
    return (
      <form onSubmit={submit} className="flex items-center gap-1 px-1">
        <Input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-8"
          maxLength={60}
          aria-label="Folder name"
        />
        <Button size="icon" variant="ghost" type="submit" aria-label="Save">
          <Check className="size-4" />
        </Button>
      </form>
    );
  }

  return (
    <div className="group relative">
      <NavItem active={active} icon={Folder} label={name} count={count} onClick={onSelect} />
      <DropdownMenu>
        <DropdownTrigger asChild>
          <button
            aria-label={`Folder actions for ${name}`}
            className="absolute right-1 top-1/2 hidden -translate-y-1/2 rounded-md bg-surface-2 p-1 text-subtle hover:text-fg group-hover:block data-[state=open]:block"
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownTrigger>
        <DropdownContent>
          <DropdownItem onSelect={() => setEditing(true)}>
            <Pencil className="size-4" /> Rename
          </DropdownItem>
          <DropdownItem danger onSelect={() => remove.mutate(id)}>
            <Trash2 className="size-4" /> Delete folder
          </DropdownItem>
        </DropdownContent>
      </DropdownMenu>
    </div>
  );
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useAuth();
  const [view, setView] = useView();
  const folders = useFolders();
  const { create } = useFolderMutations();
  const [adding, setAdding] = useState(false);
  const [folderName, setFolderName] = useState('');

  const go = (v: View) => {
    setView(v);
    onNavigate?.();
  };

  const addFolder = (e: FormEvent) => {
    e.preventDefault();
    const name = folderName.trim();
    if (!name) return;
    create.mutate(name, { onSuccess: () => setFolderName('') });
    setAdding(false);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center px-4">
        <Logo />
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-2">
        <div className="space-y-0.5">
          <NavItem
            active={view.scope === 'all' && !view.folderId}
            icon={Inbox}
            label="All notes"
            onClick={() => go({ scope: 'all' })}
          />
          <NavItem
            active={view.scope === 'owned' && !view.folderId}
            icon={FileText}
            label="My notes"
            onClick={() => go({ scope: 'owned' })}
          />
          <NavItem
            active={view.scope === 'shared' && !view.folderId}
            icon={Users}
            label="Shared with me"
            onClick={() => go({ scope: 'shared' })}
          />
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between px-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-subtle">
              Folders
            </span>
            <button
              onClick={() => setAdding((v) => !v)}
              className="rounded-md p-1 text-subtle hover:bg-surface-2 hover:text-fg"
              aria-label="New folder"
              title="New folder"
            >
              {adding ? <X className="size-3.5" /> : <FolderPlus className="size-3.5" />}
            </button>
          </div>
          {adding && (
            <form onSubmit={addFolder} className="mb-1 px-1">
              <Input
                autoFocus
                placeholder="Folder name"
                value={folderName}
                maxLength={60}
                onChange={(e) => setFolderName(e.target.value)}
                onBlur={() => !folderName && setAdding(false)}
                className="h-8"
                aria-label="New folder name"
              />
            </form>
          )}
          <div className="space-y-0.5">
            {folders.data?.map((f) => (
              <FolderRow
                key={f.id}
                id={f.id}
                name={f.name}
                count={f.noteCount}
                active={view.folderId === f.id}
                onSelect={() => go({ scope: 'all', folderId: f.id })}
              />
            ))}
            {folders.data?.length === 0 && !adding && (
              <p className="px-2.5 py-1 text-xs text-subtle">No folders yet</p>
            )}
          </div>
        </div>
      </nav>

      {user && (
        <div className="flex items-center gap-2.5 border-t border-line p-3">
          <Avatar name={user.name} id={user.id} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium" data-testid="current-user">
              {user.name}
            </p>
            <p className="truncate text-xs text-subtle">{user.email}</p>
          </div>
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void logout()}
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
