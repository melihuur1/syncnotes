import type { HocuspocusProvider } from '@hocuspocus/provider';
import { useEffect, useState } from 'react';
import { Avatar } from '../components/ui/primitives';

export interface PresentUser {
  id: string;
  name: string;
  color: string;
}

/** Other people currently in the document (deduplicated across their tabs). */
export function usePresence(
  provider: HocuspocusProvider | undefined,
  selfId: string,
): PresentUser[] {
  const [users, setUsers] = useState<PresentUser[]>([]);
  useEffect(() => {
    const awareness = provider?.awareness;
    if (!awareness) return;
    const update = () => {
      const byId = new Map<string, PresentUser>();
      awareness.getStates().forEach((state, clientId) => {
        const user = state.user as PresentUser | undefined;
        if (!user?.id || clientId === awareness.clientID || user.id === selfId) return;
        byId.set(user.id, user);
      });
      setUsers([...byId.values()].sort((a, b) => a.name.localeCompare(b.name)));
    };
    update();
    awareness.on('change', update);
    return () => awareness.off('change', update);
  }, [provider, selfId]);
  return users;
}

export function PresenceAvatars({ users, max = 4 }: { users: PresentUser[]; max?: number }) {
  if (users.length === 0) return null;
  const shown = users.slice(0, max);
  const extra = users.length - shown.length;
  return (
    <div
      className="flex items-center -space-x-1.5"
      data-testid="presence"
      aria-label={`${users.length} collaborators online`}
    >
      {shown.map((u) => (
        <Avatar key={u.id} id={u.id} name={u.name} size="sm" ring />
      ))}
      {extra > 0 && (
        <span className="inline-flex size-6 items-center justify-center rounded-full bg-surface-2 text-[10px] font-semibold text-muted ring-2 ring-surface">
          +{extra}
        </span>
      )}
    </div>
  );
}
