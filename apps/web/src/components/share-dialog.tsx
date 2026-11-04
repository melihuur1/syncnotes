import type { MemberDto, NoteRole } from '@syncnotes/shared';
import { LogOut, Trash2, UserPlus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router';
import { useLeaveNote, useMemberMutations } from '../hooks/queries';
import { useCurrentUser } from '../providers/auth';
import { Avatar, Button, Dialog, Input, RoleBadge } from './ui/primitives';

const selectClass =
  'h-9 rounded-lg border border-line bg-surface px-2 text-sm text-fg focus:border-accent focus:outline-none';

function MemberRow({
  member,
  canManage,
  noteId,
}: {
  member: MemberDto;
  canManage: boolean;
  noteId: string;
}) {
  const me = useCurrentUser();
  const { update, remove } = useMemberMutations(noteId);
  const isOwner = member.role === 'OWNER';
  return (
    <li className="flex items-center gap-3 py-2.5" data-testid="member-row">
      <Avatar id={member.userId} name={member.name} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {member.name} {member.userId === me.id && <span className="text-subtle">(you)</span>}
        </p>
        <p className="truncate text-xs text-subtle">{member.email}</p>
      </div>
      {canManage && !isOwner ? (
        <>
          <select
            aria-label={`Role of ${member.name}`}
            className={selectClass}
            value={member.role}
            disabled={update.isPending}
            onChange={(e) =>
              update.mutate({ userId: member.userId, role: e.target.value as 'EDITOR' | 'VIEWER' })
            }
          >
            <option value="EDITOR">Editor</option>
            <option value="VIEWER">Viewer</option>
          </select>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Remove ${member.name}`}
            loading={remove.isPending}
            onClick={() => remove.mutate(member.userId)}
          >
            {!remove.isPending && <Trash2 className="size-4" />}
          </Button>
        </>
      ) : (
        <RoleBadge role={member.role} />
      )}
    </li>
  );
}

export function ShareDialog({
  open,
  onOpenChange,
  noteId,
  members,
  role,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  noteId: string;
  members: MemberDto[];
  role: NoteRole;
}) {
  const isOwner = role === 'OWNER';
  const { invite } = useMemberMutations(noteId);
  const leave = useLeaveNote();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'EDITOR' | 'VIEWER'>('EDITOR');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    invite.mutate({ email: email.trim(), role: inviteRole }, { onSuccess: () => setEmail('') });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Share note"
      description={
        isOwner
          ? 'Invite people by e-mail. Editors can write, viewers can only read.'
          : 'People with access to this note.'
      }
    >
      {isOwner && (
        <form onSubmit={submit} className="mb-5 flex gap-2">
          <Input
            type="email"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-label="E-mail to invite"
            className="h-9"
          />
          <select
            aria-label="Role for the invite"
            className={selectClass}
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as 'EDITOR' | 'VIEWER')}
          >
            <option value="EDITOR">Editor</option>
            <option value="VIEWER">Viewer</option>
          </select>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            className="h-9"
            loading={invite.isPending}
          >
            {!invite.isPending && <UserPlus className="size-4" />} Invite
          </Button>
        </form>
      )}

      <ul className="divide-y divide-line" aria-label="Members">
        {members.map((m) => (
          <MemberRow key={m.userId} member={m} canManage={isOwner} noteId={noteId} />
        ))}
      </ul>

      {!isOwner && (
        <div className="mt-5 border-t border-line pt-4">
          <Button
            variant="ghost"
            size="sm"
            className="text-danger"
            loading={leave.isPending}
            onClick={() => leave.mutate(noteId, { onSuccess: () => navigate('/') })}
          >
            <LogOut className="size-4" /> Leave this note
          </Button>
        </div>
      )}
    </Dialog>
  );
}
