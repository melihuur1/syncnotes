import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as Menu from '@radix-ui/react-dropdown-menu';
import type { NoteRole } from '@syncnotes/shared';
import { clsx } from 'clsx';
import { Loader2, X } from 'lucide-react';
import {
  type ButtonHTMLAttributes,
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { colorForUser, initials } from '../../lib/colors';

export const cn = clsx;

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'icon';

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg hover:brightness-110 shadow-sm',
  secondary: 'bg-surface text-fg border border-line hover:bg-surface-2',
  ghost: 'text-muted hover:text-fg hover:bg-surface-2',
  danger: 'bg-danger text-white hover:brightness-110',
};
const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  icon: 'size-8 justify-center',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, className, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center rounded-lg font-medium transition select-none whitespace-nowrap',
        'disabled:opacity-50 disabled:pointer-events-none',
        variants[variant],
        sizes[size],
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

// ---------------------------------------------------------------------------
// Form controls
// ---------------------------------------------------------------------------

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          'h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-fg placeholder:text-subtle',
          'transition focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/15',
          className,
        )}
        {...props}
      />
    );
  },
);

export function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-muted">
        {label}
      </label>
      {children}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <Loader2
      className={cn('animate-spin text-subtle', className ?? 'size-5')}
      aria-label="Loading"
    />
  );
}

// ---------------------------------------------------------------------------
// Avatars & badges
// ---------------------------------------------------------------------------

export function Avatar({
  name,
  id,
  size = 'md',
  ring,
  className,
}: {
  name: string;
  id: string;
  size?: 'sm' | 'md';
  ring?: boolean;
  className?: string;
}) {
  return (
    <span
      title={name}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white',
        size === 'sm' ? 'size-6 text-[10px]' : 'size-8 text-xs',
        ring && 'ring-2 ring-surface',
        className,
      )}
      style={{ backgroundColor: colorForUser(id) }}
    >
      {initials(name)}
    </span>
  );
}

const roleStyles: Record<NoteRole, string> = {
  OWNER: 'bg-accent-soft text-accent',
  EDITOR: 'bg-success/12 text-success',
  VIEWER: 'bg-surface-2 text-muted',
};

export function RoleBadge({ role, className }: { role: NoteRole; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
        roleStyles[role],
        className,
      )}
    >
      {role.toLowerCase()}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2',
            'max-h-[85vh] overflow-y-auto rounded-2xl border border-line bg-elevated p-6 shadow-pop',
            wide ? 'max-w-3xl' : 'max-w-md',
          )}
        >
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <DialogPrimitive.Title className="text-base font-semibold">
                {title}
              </DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="mt-1 text-sm text-muted">
                  {description}
                </DialogPrimitive.Description>
              ) : (
                <DialogPrimitive.Description className="sr-only">
                  {title}
                </DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X className="size-4" />
              </Button>
            </DialogPrimitive.Close>
          </div>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// ---------------------------------------------------------------------------
// Dropdown menu
// ---------------------------------------------------------------------------

export const DropdownMenu = Menu.Root;
export const DropdownTrigger = Menu.Trigger;
export const DropdownSub = Menu.Sub;

export function DropdownContent({
  children,
  align = 'end',
}: {
  children: ReactNode;
  align?: 'start' | 'end';
}) {
  return (
    <Menu.Portal>
      <Menu.Content
        align={align}
        sideOffset={6}
        className="z-50 min-w-48 rounded-xl border border-line bg-elevated p-1 shadow-pop"
      >
        {children}
      </Menu.Content>
    </Menu.Portal>
  );
}

const itemClass =
  'flex cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-fg outline-none data-[highlighted]:bg-surface-2 data-[disabled]:opacity-40';

export function DropdownItem({
  children,
  onSelect,
  danger,
  disabled,
}: {
  children: ReactNode;
  onSelect?: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <Menu.Item
      onSelect={onSelect}
      disabled={disabled}
      className={cn(itemClass, danger && 'text-danger')}
    >
      {children}
    </Menu.Item>
  );
}

export function DropdownSubTrigger({ children }: { children: ReactNode }) {
  return <Menu.SubTrigger className={itemClass}>{children}</Menu.SubTrigger>;
}

export function DropdownSubContent({ children }: { children: ReactNode }) {
  return (
    <Menu.Portal>
      <Menu.SubContent
        sideOffset={6}
        className="z-50 min-w-44 rounded-xl border border-line bg-elevated p-1 shadow-pop"
      >
        {children}
      </Menu.SubContent>
    </Menu.Portal>
  );
}

export function DropdownSeparator() {
  return <Menu.Separator className="my-1 h-px bg-line" />;
}

export function DropdownLabel({ children }: { children: ReactNode }) {
  return (
    <Menu.Label className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-subtle">
      {children}
    </Menu.Label>
  );
}
