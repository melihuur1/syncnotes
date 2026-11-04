import Highlight from '@tiptap/extension-highlight';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Placeholder } from '@tiptap/extensions';
import StarterKit from '@tiptap/starter-kit';
import type { AnyExtension } from '@tiptap/core';

/**
 * Content schema shared by the live editor and the read-only version preview.
 * `undoRedo` is disabled because the Collaboration extension brings a Yjs-aware undo manager
 * (it only undoes *your* changes, never a collaborator's).
 */
export function contentExtensions(placeholder?: string): AnyExtension[] {
  return [
    StarterKit.configure({ undoRedo: false, link: { openOnClick: false, autolink: true } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Highlight,
    ...(placeholder ? [Placeholder.configure({ placeholder })] : []),
  ];
}
