import { HocuspocusProvider } from '@hocuspocus/provider';
import {
  canEdit,
  type ClientStatelessMessage,
  type NoteRole,
  parseStatelessMessage,
  type PublicUser,
  type ServerStatelessMessage,
} from '@syncnotes/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';
import { keys } from '../hooks/queries';
import { api, isApiError } from '../lib/api';
import { collabUrl } from '../lib/config';
import { clearLocalReplica, localReplicaName } from '../lib/offline-store';
import { deriveConnectionPhase, type ConnectionPhase } from './connection';

export type AccessState = 'ok' | 'revoked' | 'deleted' | 'denied';

export interface CollabSession {
  doc: Y.Doc;
  provider: HocuspocusProvider;
  persistence: IndexeddbPersistence | null;
}

export interface CollabStatus {
  phase: ConnectionPhase;
  unsyncedChanges: number;
  /** local IndexedDB replica loaded (or not used) */
  localReady: boolean;
}

/**
 * Owns the lifetime of one note's collaborative replica:
 *
 *  Y.Doc ──┬── IndexeddbPersistence   (offline copy, editors only, per user+note)
 *          └── HocuspocusProvider     (WebSocket sync; fresh API ticket on every (re)connect)
 *
 * When the user's write permission changes the replica is thrown away and rebuilt from the
 * server: updates the server rejected while read-only would otherwise leave a permanent gap in
 * this client's Yjs clock and silently block its future edits.
 */
export function useCollaboration({
  noteId,
  user,
  initialRole,
}: {
  noteId: string;
  user: PublicUser;
  initialRole: NoteRole;
}) {
  const queryClient = useQueryClient();
  const [role, setRole] = useState<NoteRole>(initialRole);
  const [generation, setGeneration] = useState(0);
  const [session, setSession] = useState<CollabSession | null>(null);
  const [access, setAccess] = useState<AccessState>('ok');
  const [online, setOnline] = useState(() => navigator.onLine);
  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>(
    'connecting',
  );
  const [synced, setSynced] = useState(false);
  const [everSynced, setEverSynced] = useState(false);
  const [unsyncedChanges, setUnsyncedChanges] = useState(0);
  const [localReady, setLocalReady] = useState(false);

  const roleRef = useRef(role);
  roleRef.current = role;
  const sessionRef = useRef<CollabSession | null>(null);

  /** Tear down the current replica, wipe its offline copy and start a fresh one. */
  const rebuildReplica = useCallback(
    async (nextRole: NoteRole) => {
      const current = sessionRef.current;
      current?.provider.destroy();
      await current?.persistence?.destroy();
      await clearLocalReplica(user.id, noteId);
      setRole(nextRole);
      setGeneration((g) => g + 1);
    },
    [noteId, user.id],
  );

  const endSession = useCallback(
    async (state: Exclude<AccessState, 'ok'>) => {
      setAccess(state);
      const current = sessionRef.current;
      current?.provider.destroy();
      await current?.persistence?.destroy();
      await clearLocalReplica(user.id, noteId);
      void queryClient.invalidateQueries({ queryKey: keys.allNotes });
    },
    [noteId, queryClient, user.id],
  );

  useEffect(() => {
    if (access !== 'ok') return;
    let disposed = false;
    const doc = new Y.Doc();
    // Viewers never write, so they don't keep an offline replica that could hold rejected edits.
    const persistence = canEdit(roleRef.current)
      ? new IndexeddbPersistence(localReplicaName(user.id, noteId), doc)
      : null;
    setLocalReady(!persistence);
    persistence?.once('synced', () => !disposed && setLocalReady(true));
    setSynced(false);
    setUnsyncedChanges(0);

    const handleStateless = (payload: string) => {
      const message = parseStatelessMessage<ServerStatelessMessage>(payload);
      if (!message) return;
      switch (message.type) {
        case 'access.changed':
          if (message.role !== roleRef.current) {
            toast.info(
              `Your access changed: you are now ${message.role === 'VIEWER' ? 'a viewer' : 'an editor'}.`,
            );
            void rebuildReplica(message.role);
          }
          break;
        case 'access.revoked':
          void endSession('revoked');
          break;
        case 'note.deleted':
          void endSession('deleted');
          break;
        case 'versions.changed':
          void queryClient.invalidateQueries({ queryKey: keys.versions(noteId) });
          break;
        case 'version.restored':
          toast.info(`${message.by} restored an earlier version.`);
          break;
        case 'error':
          toast.error(message.message);
          break;
      }
    };

    const provider = new HocuspocusProvider({
      url: collabUrl(),
      name: noteId,
      document: doc,
      // Called on every (re)connect → always a fresh, short-lived ticket.
      token: async () => {
        try {
          const ticket = await api.notes.collabTicket(noteId);
          if (
            !disposed &&
            ticket.role !== roleRef.current &&
            canEdit(ticket.role) !== canEdit(roleRef.current)
          ) {
            void rebuildReplica(ticket.role);
          } else if (!disposed) {
            setRole(ticket.role);
          }
          return ticket.token;
        } catch (err) {
          if (!disposed && (isApiError(err, 404) || isApiError(err, 403)))
            void endSession('denied');
          throw err;
        }
      },
      onStatus: ({ status }) =>
        !disposed && setWsStatus(status as 'connecting' | 'connected' | 'disconnected'),
      onSynced: ({ state }) => {
        if (disposed) return;
        setSynced(state);
        if (state) setEverSynced(true);
      },
      onUnsyncedChanges: ({ number }) => !disposed && setUnsyncedChanges(number),
      onStateless: ({ payload }) => !disposed && handleStateless(payload),
      onAuthenticationFailed: ({ reason }) => {
        if (!disposed && reason === 'not-a-member') void endSession('denied');
      },
    });

    // Browsers keep a dead WebSocket around for a long time after the network drops;
    // react to the OS network state right away instead.
    const goOnline = () => {
      setOnline(true);
      void provider.connect();
    };
    const goOffline = () => {
      setOnline(false);
      provider.disconnect();
    };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    if (!navigator.onLine) provider.disconnect();

    const next = { doc, provider, persistence };
    sessionRef.current = next;
    setSession(next);

    return () => {
      disposed = true;
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      provider.destroy();
      void persistence?.destroy();
      doc.destroy();
      if (sessionRef.current === next) sessionRef.current = null;
      setSession(null);
    };
  }, [noteId, user.id, generation, access, queryClient, rebuildReplica, endSession]);

  const send = useCallback((message: ClientStatelessMessage) => {
    sessionRef.current?.provider.sendStateless(JSON.stringify(message));
  }, []);

  const status: CollabStatus = {
    phase: deriveConnectionPhase({ online, wsStatus, synced, everSynced }),
    unsyncedChanges,
    localReady,
  };

  return { session, generation, role, access, status, send };
}
