import { useState } from 'react';
import { Link } from 'react-router';
import type { Editor } from '@tiptap/react';
import { Check, GitPullRequestDraft, X } from 'lucide-react';
import { api } from '../../api/client';
import type { Page, PageEditMode } from '../../api/types';
import type { SuggestionInfo } from '../../editor/suggestionMode';
import { useI18n } from '../../i18n';
import { useToast } from '../../lib/toast';
import { Badge, Button, Field, Modal, Switch, Time, cx } from '../../components/ui';

/** Liste der Vorschläge im Editor mit Annehmen und Ablehnen. */
export function SuggestionsPanel({ editor, suggestions, canResolve, userId }: { editor: Editor | null; suggestions: SuggestionInfo[]; canResolve: boolean; userId: number }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(true);
  if (!suggestions.length || !editor) return null;
  return (
    <section className="suggestions-panel" aria-label={t('suggest.panel')}>
      <div className="suggestions-panel-head">
        <button type="button" className="link-like strong" aria-expanded={open} onClick={() => setOpen(!open)}>
          <GitPullRequestDraft size={14} /> {t('suggest.count', { n: suggestions.length })}
        </button>
        <span className="spacer" />
        {canResolve && (
          <>
            <Button size="sm" variant="ghost" icon={Check} onClick={() => editor.chain().focus().acceptAllSuggestions().run()}>
              {t('suggest.acceptAll')}
            </Button>
            <Button size="sm" variant="ghost" icon={X} onClick={() => editor.chain().focus().rejectAllSuggestions().run()}>
              {t('suggest.rejectAll')}
            </Button>
          </>
        )}
      </div>
      {open && (
        <ul className="suggestions-list">
          {suggestions.map((sg) => (
            <li key={sg.sid}>
              <div className="suggestion-text">
                {sg.deleted && <del>{sg.deleted}</del>} {sg.inserted && <ins>{sg.inserted}</ins>}
              </div>
              <div className="small muted">
                {sg.authorName || t('suggest.unknown')}
                {sg.at && (
                  <>
                    {' · '}
                    <Time value={sg.at} />
                  </>
                )}
              </div>
              <div className="row gap-xs">
                {canResolve && (
                  <Button size="sm" icon={Check} onClick={() => editor.chain().focus().acceptSuggestion(sg.sid).run()}>
                    {t('suggest.accept')}
                  </Button>
                )}
                {(canResolve || sg.author === userId) && (
                  <Button size="sm" variant="ghost" icon={X} onClick={() => editor.chain().focus().rejectSuggestion(sg.sid).run()}>
                    {sg.author === userId && !canResolve ? t('suggest.withdraw') : t('suggest.reject')}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="small muted">{t('suggest.publishHint')}</p>
    </section>
  );
}

/** Umschalter „Bearbeiten | Vorschlagen“ in der Editorleiste. */
export function SuggestToggle({ active, forced, onChange }: { active: boolean; forced: boolean; onChange: (next: boolean) => void }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className={cx('btn btn-sm', active ? 'btn-secondary suggest-active' : 'btn-ghost')}
      aria-pressed={active}
      disabled={forced}
      title={forced ? t('suggest.forcedHint') : t('suggest.toggleHint')}
      onClick={() => onChange(!active)}
    >
      <GitPullRequestDraft size={14} /> {active ? t('suggest.on') : t('suggest.off')}
    </button>
  );
}

/** Hinweis im Seitenkopf: offene Vorschläge. */
export function SuggestionsChip({ page }: { page: Page }) {
  const { t } = useI18n();
  if (!page.editMode?.pending || !page.access.edit) return null;
  return (
    <Link to={`/s/${encodeURIComponent(page.space.key)}/edit/${page.id}`} className="page-meta-item">
      <Badge color="yellow">
        <GitPullRequestDraft size={11} /> {t('suggest.count', { n: page.editMode.pending })}
      </Badge>
    </Link>
  );
}

/** Bearbeitungsmodus einer Seite festlegen. */
export function EditModeDialog({ page, onClose, onChanged }: { page: Page; onClose: () => void; onChanged: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [mode, setMode] = useState<PageEditMode['mode']>(page.editMode.mode);
  const [locked, setLocked] = useState(page.editMode.locked);
  const [busy, setBusy] = useState(false);
  const moderator = page.review.canDecide;

  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/api/v1/pages/${page.id}/edit-mode`, { mode, locked: moderator ? locked : undefined });
      toast.success(t('common.changesSaved'));
      onChanged();
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      icon={GitPullRequestDraft}
      title={t('suggest.modeTitle')}
      footer={
        <>
          <span className="spacer" />
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="stack">
        <p className="small muted" style={{ marginTop: 0 }}>
          {t('suggest.modeIntro')}
        </p>
        <Field label={t('suggest.mode')}>
          <div className="col gap-xs">
            {(['direct', 'suggest'] as const).map((value) => (
              <label key={value} className="radio-row">
                <input type="radio" name="edit-mode" value={value} checked={mode === value} onChange={() => setMode(value)} />
                <span>
                  <strong>{t(`suggest.modes.${value}`)}</strong>
                  <span className="small muted"> – {t(`suggest.modeHelp.${value}`)}</span>
                </span>
              </label>
            ))}
          </div>
        </Field>
        {moderator && <Switch checked={locked} onChange={setLocked} label={t('suggest.lock')} description={t('suggest.lockHelp')} />}
        {page.editMode.locked && !moderator && <p className="small danger-text">{t('suggest.lockedHint')}</p>}
      </div>
    </Modal>
  );
}
