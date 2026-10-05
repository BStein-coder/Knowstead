/**
 * Editor-Erweiterungen für die gemeinsame Bearbeitung. Liegen bewusst in eigener Datei: So landen
 * Yjs und die Collaboration-Erweiterungen nur im Paket des Editors, nicht in der Seitenansicht.
 */
import type { AnyExtension } from '@tiptap/core';
import { Collaboration } from '@tiptap/extension-collaboration';
import { CollaborationCaret } from '@tiptap/extension-collaboration-caret';
import type { CollabSession, CollabUser } from './session';

/** Cursor anderer Personen: farbiger Strich mit Namensfähnchen. */
function renderCaret(user: Record<string, unknown>): HTMLElement {
  const caret = document.createElement('span');
  caret.className = 'collab-caret';
  caret.style.borderColor = String(user.color ?? '#2563eb');
  const label = document.createElement('span');
  label.className = 'collab-caret-label';
  label.style.backgroundColor = String(user.color ?? '#2563eb');
  label.textContent = String(user.name ?? '');
  caret.append(label);
  return caret;
}

export function collabExtensions(session: CollabSession, user: CollabUser): AnyExtension[] {
  return [
    Collaboration.configure({ document: session.doc, field: 'default' }),
    CollaborationCaret.configure({
      provider: { awareness: session.awareness },
      user: { id: user.id, name: user.name, color: user.color },
      render: renderCaret,
      selectionRender: (u: Record<string, unknown>) => ({ nodeName: 'span', class: 'collab-selection', style: `background-color: ${String(u.color ?? '#2563eb')}33` }),
    }),
  ];
}
