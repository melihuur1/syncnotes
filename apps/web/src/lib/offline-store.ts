import { clearDocument } from 'y-indexeddb';

/**
 * IndexedDB database name for a user's local replica of a note.
 * Scoped by user so that two accounts on one browser never see each other's cached notes.
 */
export function localReplicaName(userId: string, noteId: string): string {
  return `syncnotes:${userId}:${noteId}`;
}

export async function clearLocalReplica(userId: string, noteId: string): Promise<void> {
  await clearDocument(localReplicaName(userId, noteId)).catch(() => undefined);
}

/** On logout: remove every cached note of this user from the device. */
export async function clearAllLocalReplicas(userId: string): Promise<void> {
  if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') return;
  const prefix = `syncnotes:${userId}:`;
  const databases = await indexedDB.databases().catch(() => []);
  await Promise.all(
    databases
      .map((db) => db.name)
      .filter((name): name is string => !!name?.startsWith(prefix))
      .map(
        (name) =>
          new Promise<void>((resolve) => {
            const req = indexedDB.deleteDatabase(name);
            req.onsuccess = req.onerror = req.onblocked = () => resolve();
          }),
      ),
  );
}
