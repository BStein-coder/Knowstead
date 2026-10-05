import { useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { markdown } from '@codemirror/lang-markdown';

interface Props {
  value: string;
  onChange: (value: string) => void;
  language: string | null;
  wrap?: boolean;
  onSave?: () => void;
  autofocus?: boolean;
}

const theme = EditorView.theme({
  '&': { backgroundColor: 'transparent', color: 'var(--text)' },
  '.cm-content': { padding: '0.75rem 0' },
  '.cm-line': { padding: '0 1rem' },
});

/** CodeMirror-6-Editor für Markdown- und Code-Seiten. */
export function CodeEditor({ value, onChange, language, wrap, onSave, autofocus }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const langComp = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  useEffect(() => {
    if (!ref.current) return;
    const view = new EditorView({
      parent: ref.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          keymap.of([
            indentWithTab,
            {
              key: 'Mod-s',
              preventDefault: true,
              run: () => {
                onSaveRef.current?.();
                return true;
              },
            },
          ]),
          theme,
          wrap ? EditorView.lineWrapping : [],
          langComp.current.of([]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    if (autofocus) view.focus();
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wrap]);

  // Sprache nachladen
  useEffect(() => {
    let cancelled = false;
    const view = viewRef.current;
    if (!view) return;
    (async () => {
      let support: Extension | null = null;
      if (language === 'markdown') support = markdown({ codeLanguages: languages });
      else if (language && language !== 'plaintext') {
        const desc = LanguageDescription.matchLanguageName(languages, language, true);
        support = desc ? await desc.load() : null;
      }
      if (!cancelled) view.dispatch({ effects: langComp.current.reconfigure(support ?? []) });
    })();
    return () => {
      cancelled = true;
    };
  }, [language]);

  // Externe Änderungen übernehmen (z. B. Entwurf wiederhergestellt)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  return <div ref={ref} className="cm-wrap" />;
}
