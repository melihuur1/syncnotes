export type ConnectionPhase = 'offline' | 'connecting' | 'reconnecting' | 'synced';

export interface ConnectionInputs {
  online: boolean;
  wsStatus: 'connecting' | 'connected' | 'disconnected';
  synced: boolean;
  everSynced: boolean;
}

/** Collapses network, WebSocket and Yjs sync state into one user-facing phase. */
export function deriveConnectionPhase({
  online,
  wsStatus,
  synced,
  everSynced,
}: ConnectionInputs): ConnectionPhase {
  if (!online) return 'offline';
  if (wsStatus === 'connected' && synced) return 'synced';
  return everSynced ? 'reconnecting' : 'connecting';
}

export interface StatusPresentation {
  label: string;
  detail: string;
  tone: 'ok' | 'busy' | 'warn';
}

export function describeStatus(
  phase: ConnectionPhase,
  unsyncedChanges: number,
): StatusPresentation {
  const pending = unsyncedChanges === 1 ? '1 change' : `${unsyncedChanges} changes`;
  switch (phase) {
    case 'offline':
      return {
        label: 'Offline',
        detail:
          unsyncedChanges > 0
            ? `${pending} saved on this device — they will sync when you reconnect.`
            : 'You can keep editing; changes are saved on this device.',
        tone: 'warn',
      };
    case 'reconnecting':
      return {
        label: 'Reconnecting…',
        detail: 'Connection lost. Your edits are kept locally and will merge.',
        tone: 'warn',
      };
    case 'connecting':
      return { label: 'Connecting…', detail: 'Opening a live session.', tone: 'busy' };
    case 'synced':
      return unsyncedChanges > 0
        ? { label: 'Saving…', detail: `Sending ${pending} to the server.`, tone: 'busy' }
        : { label: 'Saved', detail: 'All changes are synced.', tone: 'ok' };
  }
}
