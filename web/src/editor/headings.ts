import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';

export function headingSlug(text: string, used: Map<string, number>): string {
  const base =
    text
      .toLowerCase()
      .replace(/[äöüß]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' })[c] ?? c)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'abschnitt';
  const count = used.get(base) ?? 0;
  used.set(base, count + 1);
  return count ? `${base}-${count + 1}` : base;
}

export interface DocHeading {
  level: number;
  text: string;
  id: string;
  pos: number;
}

export function collectHeadings(doc: PMNode, maxLevel = 6): DocHeading[] {
  const used = new Map<string, number>();
  const result: DocHeading[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      const text = node.textContent.trim();
      const id = headingSlug(text, used);
      if (node.attrs.level <= maxLevel && text) result.push({ level: node.attrs.level, text, id, pos });
      return false;
    }
    return true;
  });
  return result;
}

const key = new PluginKey('headingIds');

/** Vergibt stabile IDs an Überschriften (für Anker und Inhaltsverzeichnisse). */
export const HeadingIds = Extension.create({
  name: 'headingIds',
  addProseMirrorPlugins() {
    const build = (doc: PMNode) => {
      const decorations: Decoration[] = [];
      for (const h of collectHeadings(doc)) {
        const node = doc.nodeAt(h.pos);
        if (node) decorations.push(Decoration.node(h.pos, h.pos + node.nodeSize, { id: h.id }));
      }
      return DecorationSet.create(doc, decorations);
    };
    return [
      new Plugin({
        key,
        state: {
          init: (_, state) => build(state.doc),
          apply: (tr, old) => (tr.docChanged ? build(tr.doc) : old),
        },
        props: {
          decorations(state) {
            return key.getState(state) as DecorationSet;
          },
        },
      }),
    ];
  },
});
