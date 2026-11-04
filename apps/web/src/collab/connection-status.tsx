import { CloudOff, Loader2, RefreshCw, CheckCircle2 } from 'lucide-react';
import { cn } from '../components/ui/primitives';
import { type ConnectionPhase, describeStatus } from './connection';

const toneClass = {
  ok: 'text-success bg-success/10',
  busy: 'text-muted bg-surface-2',
  warn: 'text-warning bg-warning/12',
} as const;

export function ConnectionStatus({
  phase,
  unsyncedChanges,
}: {
  phase: ConnectionPhase;
  unsyncedChanges: number;
}) {
  const { label, detail, tone } = describeStatus(phase, unsyncedChanges);
  const Icon =
    phase === 'offline'
      ? CloudOff
      : phase === 'reconnecting'
        ? RefreshCw
        : tone === 'busy'
          ? Loader2
          : CheckCircle2;
  return (
    <span
      role="status"
      aria-live="polite"
      title={detail}
      data-testid="connection-status"
      data-phase={phase}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
        toneClass[tone],
      )}
    >
      <Icon
        className={cn('size-3.5', (tone === 'busy' || phase === 'reconnecting') && 'animate-spin')}
        aria-hidden
      />
      <span>{label}</span>
      {phase === 'offline' && unsyncedChanges > 0 && (
        <span className="tabular-nums opacity-80">· {unsyncedChanges}</span>
      )}
    </span>
  );
}
