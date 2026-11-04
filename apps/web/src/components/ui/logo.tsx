export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" className="size-7 shrink-0" aria-hidden>
        <defs>
          <linearGradient id="sn-logo" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#6366f1" />
            <stop offset="1" stopColor="#8b5cf6" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="8" fill="url(#sn-logo)" />
        <path
          d="M9 11.5h14M9 16h9M9 20.5h11"
          stroke="#fff"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <circle cx="23" cy="20.5" r="2.4" fill="#fde68a" />
      </svg>
      {!compact && <span className="text-[15px] font-semibold tracking-tight">SyncNotes</span>}
    </span>
  );
}
