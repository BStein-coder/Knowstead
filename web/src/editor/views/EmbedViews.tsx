/** Makros mit fremden oder erzeugten Inhalten: Einbettungen, Mermaid-Diagramme, Plugin-Makros. */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { NodeViewProps } from '@tiptap/react';
import { MonitorPlay, Puzzle } from 'lucide-react';
import { useI18n } from '../../i18n';
import { useAuth } from '../../lib/auth';
import { getPluginMacro, usePluginRegistry } from '../../lib/plugins';
import { Button, Field, Input, Modal, Select, Textarea } from '../../components/ui';
import { useDoc } from '../context';
import { renderMermaid } from '../render';
import { MacroFrame } from './MacroFrame';

/* ------------------------------ Einbettung ------------------------------ */

export function toEmbedUrl(raw: string): string {
  try {
    const url = new URL(raw.trim());
    if (/(^|\.)youtube\.com$/.test(url.hostname) && url.searchParams.get('v')) {
      return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(url.searchParams.get('v')!)}`;
    }
    if (url.hostname === 'youtu.be') return `https://www.youtube-nocookie.com/embed${url.pathname}`;
    if (url.hostname === 'vimeo.com') return `https://player.vimeo.com/video${url.pathname}`;
    if (url.hostname === 'www.figma.com' && !url.pathname.startsWith('/embed')) {
      return `https://www.figma.com/embed?embed_host=knowstead&url=${encodeURIComponent(raw.trim())}`;
    }
    return url.toString();
  } catch {
    return raw;
  }
}

export function EmbedView(props: NodeViewProps) {
  const { t } = useI18n();
  const { data } = useAuth();
  const src = (props.node.attrs.src as string) || '';
  const height = Number(props.node.attrs.height) || 420;
  const [draft, setDraft] = useState(src);
  const allowed = useMemo(() => {
    const hosts = data?.settings.allowedEmbedHosts ?? [];
    try {
      const u = new URL(src);
      return u.protocol === 'https:' && (hosts.length === 0 || hosts.includes(u.hostname));
    } catch {
      return false;
    }
  }, [src, data]);
  const editable = props.editor.isEditable;
  if (!src) {
    return (
      <MacroFrame props={props} title={t('macros.embed')} icon={MonitorPlay}>
        {editable ? (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              props.updateAttributes({ src: toEmbedUrl(draft) });
            }}
          >
            <Input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" />
            <Button type="submit" variant="primary">
              {t('common.apply')}
            </Button>
          </form>
        ) : (
          <div className="macro-empty">{t('macros.embedDesc')}</div>
        )}
      </MacroFrame>
    );
  }
  return (
    <MacroFrame
      props={props}
      plain
      onConfigure={() => {
        const next = window.prompt(t('macros.embedHeight'), String(height));
        if (next) props.updateAttributes({ height: Math.max(120, Math.min(2000, Number(next) || height)) });
      }}
    >
      {allowed ? (
        <iframe
          className="embed-frame"
          src={src}
          style={{ height }}
          loading="lazy"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation"
          title={src}
        />
      ) : (
        <div className="macro-empty">
          {t('macros.embedNotAllowed')}{' '}
          <a href={src} target="_blank" rel="noopener noreferrer">
            {src}
          </a>
        </div>
      )}
    </MacroFrame>
  );
}

/* ------------------------------ Mermaid ------------------------------ */

function MermaidPreview({ code }: { code: string }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [themeTick, setThemeTick] = useState(0);
  useEffect(() => {
    const onTheme = () => setThemeTick((n) => n + 1);
    window.addEventListener('knowstead:theme', onTheme);
    return () => window.removeEventListener('knowstead:theme', onTheme);
  }, []);
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (!code.trim()) {
        if (ref.current) ref.current.innerHTML = '';
        return;
      }
      try {
        const svg = await renderMermaid(code);
        if (!cancelled && ref.current) {
          ref.current.innerHTML = svg;
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message.split('\n')[0] : String(err));
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [code, themeTick]);
  return (
    <>
      <div ref={ref} className="mermaid-view" />
      {error && (
        <div className="small danger-text">
          {t('macros.mermaidError')}: {error}
        </div>
      )}
    </>
  );
}

export function MermaidView(props: NodeViewProps) {
  const { t } = useI18n();
  const code = (props.node.attrs.code as string) || '';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(code);
  useEffect(() => setDraft(code), [code]);
  return (
    <MacroFrame props={props} plain onConfigure={() => setEditing(true)}>
      <div onDoubleClick={() => props.editor.isEditable && setEditing(true)}>
        {code.trim() ? <MermaidPreview code={code} /> : <div className="macro-empty">{t('macros.mermaidDesc')}</div>}
      </div>
      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        title={t('macros.mermaid')}
        size="xl"
        footer={
          <>
            <a className="btn btn-ghost" href="https://mermaid.js.org/intro/syntax-reference.html" target="_blank" rel="noopener noreferrer">
              Syntax
            </a>
            <span className="spacer" />
            <Button onClick={() => setEditing(false)}>{t('common.cancel')}</Button>
            <Button
              variant="primary"
              onClick={() => {
                props.updateAttributes({ code: draft });
                setEditing(false);
              }}
            >
              {t('common.apply')}
            </Button>
          </>
        }
      >
        <div className="mermaid-editor">
          <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={16} spellCheck={false} autoFocus />
          <div style={{ overflow: 'auto', maxHeight: '60vh' }}>
            <MermaidPreview code={draft} />
          </div>
        </div>
      </Modal>
    </MacroFrame>
  );
}

/* ------------------------------ Plugin-Makro ------------------------------ */

export function PluginMacroView(props: NodeViewProps) {
  const { t } = useI18n();
  const doc = useDoc();
  const registry = usePluginRegistry();
  const plugin = props.node.attrs.plugin as string;
  const name = props.node.attrs.macro as string;
  const macro = getPluginMacro(plugin, name);
  const ref = useRef<HTMLDivElement>(null);
  const [config, setConfig] = useState(false);
  const params = useMemo<Record<string, unknown>>(() => {
    try {
      return JSON.parse((props.node.attrs.params as string) || '{}');
    } catch {
      return {};
    }
  }, [props.node.attrs.params]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !macro) return;
    el.innerHTML = '';
    let cleanup: void | (() => void);
    try {
      cleanup = macro.render(el, params, { pageId: doc.pageId, spaceKey: doc.spaceKey, editable: props.editor.isEditable });
    } catch (err) {
      el.textContent = t('editor.pluginMacroError', { error: err instanceof Error ? err.message : String(err) });
    }
    return () => {
      if (typeof cleanup === 'function') cleanup();
    };
  }, [macro, params, doc.pageId, doc.spaceKey, props.editor, t]);

  return (
    <MacroFrame props={props} title={macro?.label ?? t('macros.plugin')} icon={Puzzle} onConfigure={macro?.params?.length ? () => setConfig(true) : undefined}>
      {!macro ? <div className="macro-empty">{registry.loaded ? t('macros.pluginMissing', { name: `${plugin}/${name}` }) : t('common.loading')}</div> : <div ref={ref} />}
      {macro?.params && (
        <Modal open={config} onClose={() => setConfig(false)} title={macro.label} size="sm" footer={<Button variant="primary" onClick={() => setConfig(false)}>{t('common.ok')}</Button>}>
          {macro.params.map((p) => (
            <Field key={p.key} label={p.label}>
              {p.type === 'select' ? (
                <Select value={String(params[p.key] ?? p.default ?? '')} onChange={(e) => props.updateAttributes({ params: JSON.stringify({ ...params, [p.key]: e.target.value }) })}>
                  {(p.options ?? []).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              ) : p.type === 'textarea' ? (
                <Textarea value={String(params[p.key] ?? p.default ?? '')} onChange={(e) => props.updateAttributes({ params: JSON.stringify({ ...params, [p.key]: e.target.value }) })} />
              ) : p.type === 'boolean' ? (
                <input type="checkbox" checked={!!(params[p.key] ?? p.default)} onChange={(e) => props.updateAttributes({ params: JSON.stringify({ ...params, [p.key]: e.target.checked }) })} />
              ) : (
                <Input
                  type={p.type === 'number' ? 'number' : p.type === 'date' ? 'date' : 'text'}
                  value={String(params[p.key] ?? p.default ?? '')}
                  onChange={(e) => props.updateAttributes({ params: JSON.stringify({ ...params, [p.key]: p.type === 'number' ? Number(e.target.value) : e.target.value }) })}
                />
              )}
            </Field>
          ))}
        </Modal>
      )}
    </MacroFrame>
  );
}

