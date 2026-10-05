/**
 * Vorschlagsmodus („Änderungen nachverfolgen“) für den Rich-Text-Editor.
 *
 * Im Vorschlagsmodus bleibt der bisherige Text erhalten: Eingefügtes wird als `<ins data-suggestion>`
 * markiert, Gelöschtes nicht entfernt, sondern als `<del data-suggestion>` durchgestrichen. Jede
 * Markierung trägt eine Vorschlags-ID, die Person und den Zeitpunkt. Wer dazu berechtigt ist, nimmt
 * Vorschläge an (Einfügung bleibt, Löschung wird ausgeführt) oder lehnt sie ab.
 *
 * Umgesetzt als ProseMirror-Plugin, das Texteingaben und Löschungen nachträglich umwandelt
 * (`appendTransaction`). Änderungen anderer Personen aus der gemeinsamen Bearbeitung (Yjs) und die
 * eigenen Annehmen-/Ablehnen-Schritte bleiben unverändert. Formatierungen und Knoteneinstellungen
 * lassen sich im Vorschlagsmodus nicht ändern – der Server prüft beim Veröffentlichen zusätzlich,
 * dass sich der Text nur über Vorschläge geändert hat.
 */
import { Extension, Mark, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Fragment, Slice, type MarkType, type Node as PMNode } from '@tiptap/pm/model';
import { AddMarkStep, AttrStep, Mapping, RemoveMarkStep, ReplaceAroundStep, ReplaceStep } from '@tiptap/pm/transform';

export interface SuggestionUser {
  id: number;
  name: string;
}

export interface SuggestionInfo {
  sid: string;
  author: number;
  authorName: string;
  at: string;
  inserted: string;
  deleted: string;
}

interface PluginState {
  enabled: boolean;
  user: SuggestionUser | null;
}

export const suggestionModeKey = new PluginKey<PluginState>('suggestionMode');
/** Meta für Schritte, die nicht in Vorschläge umgewandelt werden (Annehmen, Ablehnen, Laden) */
export const SUGGESTION_SKIP = 'suggestionModeSkip';
const YJS_META = 'y-sync$';

const suggestionAttributes = {
  sid: { default: '', parseHTML: (el: HTMLElement) => el.getAttribute('data-sid') ?? '', renderHTML: (a: Record<string, unknown>) => ({ 'data-sid': a.sid }) },
  author: { default: 0, parseHTML: (el: HTMLElement) => Number(el.getAttribute('data-author')) || 0, renderHTML: (a: Record<string, unknown>) => ({ 'data-author': a.author }) },
  authorName: { default: '', parseHTML: (el: HTMLElement) => el.getAttribute('data-author-name') ?? '', renderHTML: (a: Record<string, unknown>) => ({ 'data-author-name': a.authorName }) },
  at: { default: '', parseHTML: (el: HTMLElement) => el.getAttribute('data-at') ?? '', renderHTML: (a: Record<string, unknown>) => ({ 'data-at': a.at }) },
};

export const SuggestionInsert = Mark.create({
  name: 'suggestionInsert',
  inclusive: true,
  // Eigener Typ muss ausdrücklich genannt werden – sonst verschachteln sich Markierungen bei jedem Tastendruck
  excludes: 'suggestionInsert suggestionDelete',
  priority: 1100,
  addAttributes: () => suggestionAttributes,
  parseHTML: () => [{ tag: 'ins[data-suggestion]' }],
  renderHTML: ({ HTMLAttributes }) => ['ins', mergeAttributes({ 'data-suggestion': 'insert', class: 'knowstead-suggestion-insert' }, HTMLAttributes), 0],
});

export const SuggestionDelete = Mark.create({
  name: 'suggestionDelete',
  inclusive: false,
  excludes: 'suggestionInsert suggestionDelete',
  priority: 1100,
  addAttributes: () => suggestionAttributes,
  parseHTML: () => [{ tag: 'del[data-suggestion]' }],
  renderHTML: ({ HTMLAttributes }) => ['del', mergeAttributes({ 'data-suggestion': 'delete', class: 'knowstead-suggestion-delete' }, HTMLAttributes), 0],
});

function newSid(): string {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function isRemote(tr: Transaction): boolean {
  const meta = tr.getMeta(YJS_META) as { isChangeOrigin?: boolean } | undefined;
  return !!meta?.isChangeOrigin;
}

/** Merkmale eines benachbarten Vorschlags derselben Person (Weitertippen, weitere Rücktaste) – ein Vorschlag bleibt ein Stück. */
function adjacentAttrs(doc: PMNode, pos: number, types: MarkType[], author: number): Record<string, unknown> | null {
  const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
  for (const node of [$pos.nodeBefore, $pos.nodeAfter]) {
    const mark = node?.marks.find((m) => types.includes(m.type) && m.attrs.author === author);
    if (mark?.attrs.sid) return { ...mark.attrs };
  }
  return null;
}

/** Gelöschten Inhalt als Löschvorschlag markieren; eigene Einfügungen verschwinden wirklich. */
function markDeleted(slice: Slice, insType: MarkType, delType: MarkType, attrs: Record<string, unknown>, author: number): Slice {
  const transform = (fragment: Fragment): Fragment => {
    const nodes: PMNode[] = [];
    fragment.forEach((node) => {
      if (node.isText) {
        const inserted = node.marks.find((m) => m.type === insType);
        if (inserted && inserted.attrs.author === author) return;
        if (inserted || node.marks.some((m) => m.type === delType)) {
          nodes.push(node);
          return;
        }
        nodes.push(node.mark(delType.create(attrs).addToSet(node.marks)));
      } else if (node.isLeaf) {
        nodes.push(node);
      } else {
        nodes.push(node.copy(transform(node.content)));
      }
    });
    return Fragment.from(nodes);
  };
  return new Slice(transform(slice.content), slice.openStart, slice.openEnd);
}

type Op = { kind: 'ins'; from: number; to: number } | { kind: 'del'; pos: number; slice: Slice; backward: boolean };

export interface SuggestionModeOptions {
  /** Wird aufgerufen, wenn eine Formatierung im Vorschlagsmodus verhindert wurde */
  onBlocked?: () => void;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    suggestionMode: {
      setSuggestionMode: (enabled: boolean, user: SuggestionUser | null) => ReturnType;
      acceptSuggestion: (sid: string) => ReturnType;
      rejectSuggestion: (sid: string) => ReturnType;
      acceptAllSuggestions: () => ReturnType;
      rejectAllSuggestions: () => ReturnType;
    };
  }
}

/** Alle Vorschläge eines Dokuments, gruppiert nach ID. */
export function collectSuggestions(doc: PMNode): SuggestionInfo[] {
  const byId = new Map<string, SuggestionInfo>();
  doc.descendants((node) => {
    if (!node.isText) return;
    for (const mark of node.marks) {
      const kind = mark.type.name === 'suggestionInsert' ? 'inserted' : mark.type.name === 'suggestionDelete' ? 'deleted' : null;
      if (!kind) continue;
      const sid = String(mark.attrs.sid || 'ohne-id');
      const entry = byId.get(sid) ?? { sid, author: Number(mark.attrs.author) || 0, authorName: String(mark.attrs.authorName ?? ''), at: String(mark.attrs.at ?? ''), inserted: '', deleted: '' };
      entry[kind] += node.text ?? '';
      byId.set(sid, entry);
    }
  });
  return [...byId.values()];
}

function rangesOf(doc: PMNode, sid: string | null, typeName: string): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const mark = node.marks.find((m) => m.type.name === typeName && (sid === null || m.attrs.sid === sid));
    if (!mark) return;
    const last = ranges[ranges.length - 1];
    if (last && last.to === pos) last.to = pos + node.nodeSize;
    else ranges.push({ from: pos, to: pos + node.nodeSize });
  });
  return ranges;
}

function resolve(state: EditorState, sid: string | null, accept: boolean): Transaction {
  const tr = state.tr.setMeta(SUGGESTION_SKIP, true);
  const insType = state.schema.marks.suggestionInsert;
  const delType = state.schema.marks.suggestionDelete;
  // Annehmen: Einfügungen behalten, Löschungen ausführen – Ablehnen umgekehrt
  const keep = accept ? 'suggestionInsert' : 'suggestionDelete';
  const remove = accept ? 'suggestionDelete' : 'suggestionInsert';
  for (const range of rangesOf(state.doc, sid, keep)) tr.removeMark(range.from, range.to, keep === 'suggestionInsert' ? insType : delType);
  for (const range of rangesOf(tr.doc, sid, remove).reverse()) tr.delete(range.from, range.to);
  return tr;
}

export const SuggestionMode = Extension.create<SuggestionModeOptions>({
  name: 'suggestionMode',

  addOptions() {
    return { onBlocked: undefined };
  },

  addCommands() {
    return {
      setSuggestionMode:
        (enabled, user) =>
        ({ tr, dispatch }) => {
          if (dispatch) tr.setMeta(suggestionModeKey, { enabled, user }).setMeta(SUGGESTION_SKIP, true).setMeta('addToHistory', false);
          return true;
        },
      acceptSuggestion:
        (sid) =>
        ({ state, dispatch }) => {
          if (dispatch) dispatch(resolve(state, sid, true));
          return true;
        },
      rejectSuggestion:
        (sid) =>
        ({ state, dispatch }) => {
          if (dispatch) dispatch(resolve(state, sid, false));
          return true;
        },
      acceptAllSuggestions:
        () =>
        ({ state, dispatch }) => {
          if (dispatch) dispatch(resolve(state, null, true));
          return true;
        },
      rejectAllSuggestions:
        () =>
        ({ state, dispatch }) => {
          if (dispatch) dispatch(resolve(state, null, false));
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin<PluginState>({
        key: suggestionModeKey,
        state: {
          init: () => ({ enabled: false, user: null }),
          apply: (tr, value) => (tr.getMeta(suggestionModeKey) as PluginState | undefined) ?? value,
        },

        filterTransaction(tr, state) {
          const st = suggestionModeKey.getState(state);
          if (!st?.enabled || tr.getMeta(SUGGESTION_SKIP) || isRemote(tr) || !tr.docChanged) return true;
          for (const step of tr.steps) {
            const markStep = step instanceof AddMarkStep || step instanceof RemoveMarkStep;
            if ((markStep && !(step as AddMarkStep).mark.type.name.startsWith('suggestion')) || step instanceof AttrStep || step instanceof ReplaceAroundStep) {
              options.onBlocked?.();
              return false;
            }
          }
          return true;
        },

        appendTransaction(transactions, oldState, newState) {
          const st = suggestionModeKey.getState(newState);
          if (!st?.enabled || !st.user) return null;
          const insType = newState.schema.marks.suggestionInsert;
          const delType = newState.schema.marks.suggestionDelete;
          const ops: Op[] = [];
          transactions.forEach((tr, index) => {
            if (!tr.docChanged || tr.getMeta(SUGGESTION_SKIP) || isRemote(tr)) return;
            const later = new Mapping();
            for (let k = index + 1; k < transactions.length; k++) later.appendMapping(transactions[k].mapping);
            tr.steps.forEach((step, i) => {
              if (!(step instanceof ReplaceStep)) return;
              const map = new Mapping(tr.mapping.maps.slice(i + 1));
              map.appendMapping(later);
              const docBefore = tr.docs[i];
              if (step.slice.size) ops.push({ kind: 'ins', from: map.map(step.from, -1), to: map.map(step.from + step.slice.size, 1) });
              if (step.to > step.from) {
                const head = index === 0 && i === 0 ? oldState.selection.head : -1;
                ops.push({ kind: 'del', pos: map.map(step.from, -1), slice: docBefore.slice(step.from, step.to), backward: head === step.to });
              }
            });
          });
          if (!ops.length) return null;

          const out = newState.tr.setMeta(SUGGESTION_SKIP, true);
          const author = st.user.id;
          let attrs: Record<string, unknown> | null = null;
          for (const op of ops) attrs ??= adjacentAttrs(newState.doc, op.kind === 'ins' ? op.from : op.pos, [insType, delType], author);
          attrs ??= { sid: newSid(), author, authorName: st.user.name, at: new Date().toISOString() };

          for (const op of ops) {
            if (op.kind !== 'ins') continue;
            const from = out.mapping.map(op.from, -1);
            const to = out.mapping.map(op.to, 1);
            if (to > from) out.addMark(from, to, insType.create(attrs));
          }
          let cursor: number | null = null;
          for (const op of ops) {
            if (op.kind !== 'del') continue;
            const marked = markDeleted(op.slice, insType, delType, attrs, author);
            if (!marked.content.size) continue;
            const pos = out.mapping.map(op.pos, -1);
            const before = out.doc.content.size;
            try {
              out.replace(pos, pos, marked);
            } catch {
              continue;
            }
            // Rücktaste: Cursor vor den durchgestrichenen Text, Entf-Taste: dahinter
            cursor = op.backward ? pos : pos + (out.doc.content.size - before);
          }
          // Nur bei reinen Löschungen – beim Überschreiben steht der Cursor schon hinter dem neuen Text
          if (cursor !== null && newState.selection.empty && !ops.some((op) => op.kind === 'ins')) {
            out.setSelection(TextSelection.create(out.doc, Math.max(0, Math.min(cursor, out.doc.content.size))));
          }
          return out.docChanged ? out : null;
        },
      }),
    ];
  },
});
