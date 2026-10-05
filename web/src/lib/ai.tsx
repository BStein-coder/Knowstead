import { useState } from 'react';
import type { Editor } from '@tiptap/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlignLeft, ClipboardPlus, Copy, Languages, ListTree, MessageCircleQuestion, Replace, Scissors, Sparkles, Tags, Type, Wand2, ListChecks } from 'lucide-react';
import { api } from '../api/client';
import type { AiAction, AiResult, AiStatus, Page } from '../api/types';
import { useI18n } from '../i18n';
import { useAuth } from './auth';
import { useToast } from './toast';
import { renderMarkdownPreview } from '../editor/markdownPreview';
import { Badge, Button, Field, Input, Menu, Modal, Select, Spinner, Tabs, Textarea } from '../components/ui';

export function useAiStatus() {
  const { user, data } = useAuth();
  return useQuery({
    queryKey: ['ai-status'],
    queryFn: () => api.get<AiStatus>('/api/v1/ai/status'),
    enabled: !!user && !!data?.aiAvailable,
    staleTime: 60_000,
  });
}

export function runAi(input: { action: AiAction; text?: string; pageId?: number; language?: string; question?: string; instruction?: string }) {
  return api.post<AiResult>('/api/v1/ai/run', input);
}

/** Zielsprachen der Übersetzung – der Wert geht als Sprachname an die KI, die Beschriftung folgt der Oberfläche */
const LANGUAGES = ['en', 'de', 'fr', 'es', 'it', 'nl', 'pl', 'tr', 'uk'] as const;
/** Sprachname für die Anweisung an die KI (englisch – versteht jedes Modell) */
const languageName = (code: string) => new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code;

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------ Seiten-Assistent ------------------------------ */

type Tab = 'summarize' | 'ask' | 'tags' | 'title' | 'tasks';

/** KI-Assistent zur geöffneten Seite: Zusammenfassung, Fragen, Vorschläge. */
export function AiAssistantDialog({ page, open, onClose }: { page: Page; open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const status = useAiStatus();
  const actions = status.data?.actions ?? [];
  const tabs = (['summarize', 'ask', 'tags', 'title', 'tasks'] as Tab[]).filter((a) => actions.includes(a));
  const [tab, setTab] = useState<Tab>(tabs[0] ?? 'summarize');
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<AiResult | null>(null);

  const run = useMutation({
    mutationFn: (action: Tab) => runAi({ action, pageId: page.id, question: action === 'ask' ? question : undefined }),
    onSuccess: (res) => {
      setResult(res);
      void qc.invalidateQueries({ queryKey: ['ai-status'] });
    },
    onError: (err) => toast.error(err),
  });

  const applyTags = async (items: string[]) => {
    try {
      await api.put(`/api/v1/pages/${page.id}/labels`, { labels: [...new Set([...page.labels, ...items])] });
      toast.success(t('ai.tagsApplied'));
      void qc.invalidateQueries({ queryKey: ['page', page.id] });
    } catch (err) {
      toast.error(err);
    }
  };

  const toClipboard = async (text: string) => {
    try {
      await api.post('/api/v1/clips', { content: renderMarkdownPreview(text), kind: 'html', title: `${t(`ai.actions.${result?.action ?? 'summarize'}`)}: ${page.title}`, sourcePageId: page.id });
      toast.success(t('clipboard.added'));
      void qc.invalidateQueries({ queryKey: ['clips'] });
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t('ai.assistant')} icon={Sparkles} size="lg">
      {!tabs.length ? (
        <p className="muted">{t('ai.unavailable')}</p>
      ) : (
        <>
          <Tabs
            value={tab}
            onChange={(v) => {
              setTab(v);
              setResult(null);
            }}
            items={tabs.map((a) => ({ value: a, label: t(`ai.actions.${a}`) }))}
          />
          <div className="ai-panel">
            {tab === 'ask' && (
              <Field label={t('ai.question')}>
                <Textarea rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={t('ai.questionPlaceholder')} autoFocus />
              </Field>
            )}
            <div className="row gap-sm">
              <Button variant="primary" icon={Sparkles} loading={run.isPending} disabled={tab === 'ask' && !question.trim()} onClick={() => run.mutate(tab)}>
                {result ? t('ai.again') : t(`ai.run.${tab}`)}
              </Button>
              <span className="spacer" />
              {status.data?.remaining !== null && status.data?.remaining !== undefined && (
                <span className="tiny faint">{t('ai.remaining', { n: status.data.remaining })}</span>
              )}
            </div>
            {run.isPending && (
              <div className="ai-thinking">
                <Spinner /> {t('ai.working')}
              </div>
            )}
            {result && !run.isPending && (
              <div className="ai-result">
                {result.items && (tab === 'tags' || tab === 'title') ? (
                  <div className="ai-items">
                    {result.items.map((item) => (
                      <Badge key={item} color="blue">
                        {item}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <div className="doc doc-html ai-markdown" dangerouslySetInnerHTML={{ __html: renderMarkdownPreview(result.text) }} />
                )}
                <div className="row gap-sm ai-result-actions">
                  <Button size="sm" icon={Copy} onClick={() => void copyText(result.text).then((ok) => ok && toast.success(t('common.copied')))}>
                    {t('common.copy')}
                  </Button>
                  <Button size="sm" icon={ClipboardPlus} onClick={() => void toClipboard(result.text)}>
                    {t('clipboard.add')}
                  </Button>
                  {tab === 'tags' && result.items && page.access.edit && (
                    <Button size="sm" icon={Tags} onClick={() => void applyTags(result.items!)}>
                      {t('ai.applyTags')}
                    </Button>
                  )}
                  <span className="spacer" />
                  <span className="tiny faint">
                    {result.model} · {result.usage.inputTokens + result.usage.outputTokens} Token
                  </span>
                </div>
                <p className="tiny faint" style={{ margin: 0 }}>
                  {t('ai.disclaimer')}
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}

/* ------------------------------ Editor-Menü ------------------------------ */

interface Pending {
  action: AiAction;
  result: AiResult | null;
  from: number;
  to: number;
  source: string;
}

/**
 * KI im Editor: arbeitet mit der Markierung (oder dem ganzen Text), zeigt das
 * Ergebnis zuerst als Vorschau – übernommen wird erst auf Knopfdruck.
 */
export function AiEditorMenu({ editor, pageId }: { editor: Editor; pageId?: number | null }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const status = useAiStatus();
  const [pending, setPending] = useState<Pending | null>(null);
  const [language, setLanguage] = useState<string>('en');
  const [instruction, setInstruction] = useState('');
  const actions = status.data?.actions ?? [];
  if (!status.data?.available) return null;

  const start = (action: AiAction) => {
    const { from, to, empty } = editor.state.selection;
    const range = empty ? { from: 0, to: editor.state.doc.content.size } : { from, to };
    const source = editor.state.doc.textBetween(range.from, range.to, '\n\n', ' ').trim();
    if (!source) {
      toast.info(t('ai.nothingSelected'));
      return;
    }
    setPending({ action, result: null, from: range.from, to: range.to, source });
    if (action !== 'translate') void execute(action, source, range);
  };

  const execute = async (action: AiAction, source: string, range: { from: number; to: number }) => {
    setPending({ action, result: null, ...range, source });
    try {
      const result = await runAi({ action, text: source, pageId: pageId ?? undefined, language: action === 'translate' ? languageName(language) : undefined, instruction: instruction || undefined });
      setPending({ action, result, ...range, source });
      void qc.invalidateQueries({ queryKey: ['ai-status'] });
    } catch (err) {
      toast.error(err);
      setPending(null);
    }
  };

  const html = (text: string) => renderMarkdownPreview(text);

  const replace = () => {
    if (!pending?.result) return;
    editor.chain().focus().insertContentAt({ from: pending.from, to: pending.to }, html(pending.result.text)).run();
    setPending(null);
  };

  const insertBelow = () => {
    if (!pending?.result) return;
    editor.chain().focus().insertContentAt(pending.to, html(pending.result.text)).run();
    setPending(null);
  };

  const items = [
    { action: 'improve' as const, icon: Wand2 },
    { action: 'shorten' as const, icon: Scissors },
    { action: 'translate' as const, icon: Languages },
    { action: 'summarize' as const, icon: AlignLeft },
    { action: 'outline' as const, icon: ListTree },
    { action: 'tasks' as const, icon: ListChecks },
    { action: 'title' as const, icon: Type },
  ].filter((i) => actions.includes(i.action));

  const replacing = pending && ['improve', 'shorten', 'translate'].includes(pending.action);

  return (
    <>
      <Menu
        placement="bottom-start"
        trigger={(p) => (
          <button {...p} ref={p.ref as never} type="button" className="toolbar-btn-text ai-trigger" title={t('ai.assistant')}>
            <Sparkles size={15} /> KI
          </button>
        )}
        items={[{ heading: t('ai.onSelection') }, ...items.map((i) => ({ label: t(`ai.actions.${i.action}`), icon: i.icon, onClick: () => start(i.action) }))]}
      />
      {pending && (
        <Modal
          open
          onClose={() => setPending(null)}
          title={t(`ai.actions.${pending.action}`)}
          icon={Sparkles}
          size="lg"
          footer={
            pending.result ? (
              <>
                <Button variant="ghost" onClick={() => setPending(null)}>
                  {t('ai.discard')}
                </Button>
                <span className="spacer" />
                <Button icon={Copy} onClick={() => void copyText(pending.result!.text).then((ok) => ok && toast.success(t('common.copied')))}>
                  {t('common.copy')}
                </Button>
                {pending.action !== 'title' && (
                  <Button onClick={insertBelow} icon={MessageCircleQuestion}>
                    {t('ai.insertBelow')}
                  </Button>
                )}
                {replacing && (
                  <Button variant="primary" icon={Replace} onClick={replace}>
                    {t('ai.replace')}
                  </Button>
                )}
              </>
            ) : undefined
          }
        >
          {pending.action === 'translate' && !pending.result && (
            <div className="row gap-sm" style={{ alignItems: 'flex-end' }}>
              <Field label={t('ai.targetLanguage')} className="grow">
                <Select value={language} onChange={(e) => setLanguage(e.target.value)}>
                  {LANGUAGES.map((code) => (
                    <option key={code} value={code}>
                      {t(`ai.languages.${code}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button variant="primary" icon={Languages} onClick={() => void execute('translate', pending.source, pending)}>
                {t('ai.run.translate')}
              </Button>
            </div>
          )}
          {!pending.result && pending.action !== 'translate' && (
            <div className="ai-thinking">
              <Spinner /> {t('ai.working')}
            </div>
          )}
          {pending.result && (
            <>
              {pending.result.items && pending.action === 'title' ? (
                <ul className="ai-title-list">
                  {pending.result.items.map((item) => (
                    <li key={item}>
                      <button type="button" className="picker-item" onClick={() => void copyText(item).then((ok) => ok && toast.success(t('common.copied')))}>
                        <Type size={14} /> {item}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="doc doc-html ai-markdown ai-preview" dangerouslySetInnerHTML={{ __html: html(pending.result.text) }} />
              )}
              <Field label={t('ai.refine')}>
                <div className="row gap-xs">
                  <Input value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder={t('ai.refinePlaceholder')} />
                  <Button icon={Sparkles} onClick={() => void execute(pending.action, pending.source, pending)}>
                    {t('ai.again')}
                  </Button>
                </div>
              </Field>
              <p className="tiny faint" style={{ margin: 0 }}>
                {t('ai.disclaimer')}
              </p>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
