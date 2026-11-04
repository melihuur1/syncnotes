import type { Editor } from '@tiptap/react';
import { useEditorState } from '@tiptap/react';
import {
  Bold,
  Code,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Italic,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Strikethrough,
  Underline,
  Undo2,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../components/ui/primitives';

function ToolButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} // keep the editor selection
      onClick={onClick}
      className={cn(
        'inline-flex size-8 items-center justify-center rounded-md transition',
        active ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-2 hover:text-fg',
        'disabled:pointer-events-none disabled:opacity-35',
      )}
    >
      {children}
    </button>
  );
}

const Divider = () => <span className="mx-1 h-5 w-px bg-line" aria-hidden />;

export function Toolbar({ editor, disabled }: { editor: Editor; disabled: boolean }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      highlight: e.isActive('highlight'),
      h1: e.isActive('heading', { level: 1 }),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      task: e.isActive('taskList'),
      quote: e.isActive('blockquote'),
      codeBlock: e.isActive('codeBlock'),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const chain = () => editor.chain().focus();

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="flex flex-wrap items-center gap-0.5 rounded-xl border border-line bg-surface/90 p-1 shadow-card backdrop-blur"
    >
      <ToolButton
        label="Undo (Ctrl+Z)"
        disabled={disabled || !s.canUndo}
        onClick={() => chain().undo().run()}
      >
        <Undo2 className="size-4" />
      </ToolButton>
      <ToolButton
        label="Redo (Ctrl+Shift+Z)"
        disabled={disabled || !s.canRedo}
        onClick={() => chain().redo().run()}
      >
        <Redo2 className="size-4" />
      </ToolButton>
      <Divider />
      <ToolButton
        label="Heading 1"
        active={s.h1}
        disabled={disabled}
        onClick={() => chain().toggleHeading({ level: 1 }).run()}
      >
        <Heading1 className="size-4" />
      </ToolButton>
      <ToolButton
        label="Heading 2"
        active={s.h2}
        disabled={disabled}
        onClick={() => chain().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 className="size-4" />
      </ToolButton>
      <ToolButton
        label="Heading 3"
        active={s.h3}
        disabled={disabled}
        onClick={() => chain().toggleHeading({ level: 3 }).run()}
      >
        <Heading3 className="size-4" />
      </ToolButton>
      <Divider />
      <ToolButton
        label="Bold (Ctrl+B)"
        active={s.bold}
        disabled={disabled}
        onClick={() => chain().toggleBold().run()}
      >
        <Bold className="size-4" />
      </ToolButton>
      <ToolButton
        label="Italic (Ctrl+I)"
        active={s.italic}
        disabled={disabled}
        onClick={() => chain().toggleItalic().run()}
      >
        <Italic className="size-4" />
      </ToolButton>
      <ToolButton
        label="Underline (Ctrl+U)"
        active={s.underline}
        disabled={disabled}
        onClick={() => chain().toggleUnderline().run()}
      >
        <Underline className="size-4" />
      </ToolButton>
      <ToolButton
        label="Strikethrough"
        active={s.strike}
        disabled={disabled}
        onClick={() => chain().toggleStrike().run()}
      >
        <Strikethrough className="size-4" />
      </ToolButton>
      <ToolButton
        label="Highlight"
        active={s.highlight}
        disabled={disabled}
        onClick={() => chain().toggleHighlight().run()}
      >
        <Highlighter className="size-4" />
      </ToolButton>
      <ToolButton
        label="Inline code"
        active={s.code}
        disabled={disabled}
        onClick={() => chain().toggleCode().run()}
      >
        <Code className="size-4" />
      </ToolButton>
      <Divider />
      <ToolButton
        label="Bullet list"
        active={s.bullet}
        disabled={disabled}
        onClick={() => chain().toggleBulletList().run()}
      >
        <List className="size-4" />
      </ToolButton>
      <ToolButton
        label="Numbered list"
        active={s.ordered}
        disabled={disabled}
        onClick={() => chain().toggleOrderedList().run()}
      >
        <ListOrdered className="size-4" />
      </ToolButton>
      <ToolButton
        label="Checklist"
        active={s.task}
        disabled={disabled}
        onClick={() => chain().toggleTaskList().run()}
      >
        <ListChecks className="size-4" />
      </ToolButton>
      <ToolButton
        label="Quote"
        active={s.quote}
        disabled={disabled}
        onClick={() => chain().toggleBlockquote().run()}
      >
        <Quote className="size-4" />
      </ToolButton>
      <ToolButton
        label="Code block"
        active={s.codeBlock}
        disabled={disabled}
        onClick={() => chain().toggleCodeBlock().run()}
      >
        <Code2 className="size-4" />
      </ToolButton>
      <ToolButton
        label="Divider"
        disabled={disabled}
        onClick={() => chain().setHorizontalRule().run()}
      >
        <Minus className="size-4" />
      </ToolButton>
    </div>
  );
}
