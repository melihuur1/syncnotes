import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConnectionStatus } from './connection-status';
import { deriveConnectionPhase, describeStatus } from './connection';

describe('deriveConnectionPhase', () => {
  const base = { online: true, wsStatus: 'connected' as const, synced: true, everSynced: true };

  it('reports offline first, regardless of the socket state', () => {
    expect(deriveConnectionPhase({ ...base, online: false })).toBe('offline');
  });

  it('is synced only when the socket is connected and the doc is synced', () => {
    expect(deriveConnectionPhase(base)).toBe('synced');
    expect(deriveConnectionPhase({ ...base, synced: false })).toBe('reconnecting');
  });

  it('distinguishes the first connection from a reconnect', () => {
    expect(
      deriveConnectionPhase({ ...base, wsStatus: 'connecting', synced: false, everSynced: false }),
    ).toBe('connecting');
    expect(deriveConnectionPhase({ ...base, wsStatus: 'disconnected', synced: false })).toBe(
      'reconnecting',
    );
  });
});

describe('describeStatus', () => {
  it('explains pending local changes while offline', () => {
    expect(describeStatus('offline', 3).detail).toMatch(/3 changes saved on this device/);
    expect(describeStatus('offline', 1).detail).toMatch(/1 change saved/);
  });

  it('shows saving vs saved when connected', () => {
    expect(describeStatus('synced', 2).label).toBe('Saving…');
    expect(describeStatus('synced', 0).label).toBe('Saved');
  });
});

describe('<ConnectionStatus />', () => {
  it('renders an accessible live status with the pending count when offline', () => {
    render(<ConnectionStatus phase="offline" unsyncedChanges={4} />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Offline');
    expect(status).toHaveTextContent('4');
    expect(status).toHaveAttribute('data-phase', 'offline');
  });

  it('renders the saved state', () => {
    render(<ConnectionStatus phase="synced" unsyncedChanges={0} />);
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });
});
