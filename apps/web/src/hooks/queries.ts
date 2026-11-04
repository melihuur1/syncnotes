import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, type NoteFilters } from '../lib/api';

export const keys = {
  notes: (filters: NoteFilters) => ['notes', filters] as const,
  allNotes: ['notes'] as const,
  note: (id: string) => ['note', id] as const,
  folders: ['folders'] as const,
  members: (id: string) => ['members', id] as const,
  versions: (id: string) => ['versions', id] as const,
};

const toastError = (err: unknown) =>
  toast.error(err instanceof Error ? err.message : 'Something went wrong');

export function useNotes(filters: NoteFilters) {
  return useQuery({ queryKey: keys.notes(filters), queryFn: () => api.notes.list(filters) });
}

export function useNote(noteId: string) {
  return useQuery({
    queryKey: keys.note(noteId),
    queryFn: () => api.notes.get(noteId),
    retry: false,
  });
}

export function useFolders() {
  return useQuery({ queryKey: keys.folders, queryFn: api.folders.list });
}

export function useVersions(noteId: string, enabled = true) {
  return useQuery({
    queryKey: keys.versions(noteId),
    queryFn: () => api.versions.list(noteId),
    enabled,
  });
}

function useInvalidateNotes() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: keys.allNotes });
    void qc.invalidateQueries({ queryKey: keys.folders });
  };
}

export function useCreateNote() {
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: (folderId?: string) => api.notes.create(folderId),
    onSuccess: invalidate,
    onError: toastError,
  });
}

export function useDeleteNote() {
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: (noteId: string) => api.notes.remove(noteId),
    onSuccess: () => {
      invalidate();
      toast.success('Note deleted');
    },
    onError: toastError,
  });
}

export function useLeaveNote() {
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: (noteId: string) => api.notes.leave(noteId),
    onSuccess: () => {
      invalidate();
      toast.success('You left the note');
    },
    onError: toastError,
  });
}

export function useMoveNote() {
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: ({ noteId, folderId }: { noteId: string; folderId: string | null }) =>
      api.notes.move(noteId, folderId),
    onSuccess: invalidate,
    onError: toastError,
  });
}

export function useFolderMutations() {
  const invalidate = useInvalidateNotes();
  return {
    create: useMutation({
      mutationFn: (name: string) => api.folders.create(name),
      onSuccess: invalidate,
      onError: toastError,
    }),
    rename: useMutation({
      mutationFn: ({ id, name }: { id: string; name: string }) => api.folders.rename(id, name),
      onSuccess: invalidate,
      onError: toastError,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.folders.remove(id),
      onSuccess: invalidate,
      onError: toastError,
    }),
  };
}

export function useMemberMutations(noteId: string) {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: keys.note(noteId) });
    void qc.invalidateQueries({ queryKey: keys.allNotes });
  };
  return {
    invite: useMutation({
      mutationFn: ({ email, role }: { email: string; role: 'EDITOR' | 'VIEWER' }) =>
        api.members.invite(noteId, email, role),
      onSuccess: (m) => {
        invalidate();
        toast.success(`${m.name} can now ${m.role === 'EDITOR' ? 'edit' : 'view'} this note`);
      },
      onError: toastError,
    }),
    update: useMutation({
      mutationFn: ({ userId, role }: { userId: string; role: 'EDITOR' | 'VIEWER' }) =>
        api.members.update(noteId, userId, role),
      onSuccess: invalidate,
      onError: toastError,
    }),
    remove: useMutation({
      mutationFn: (userId: string) => api.members.remove(noteId, userId),
      onSuccess: () => {
        invalidate();
        toast.success('Access removed');
      },
      onError: toastError,
    }),
  };
}
