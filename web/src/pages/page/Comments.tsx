import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { Check, CornerDownRight, MessageSquare, Pencil, RotateCcw, Trash2, X } from 'lucide-react';
import { api } from '../../api/client';
import type { Comment, Page, UserRef } from '../../api/types';
import { useComments } from '../../api/hooks';
import { useI18n } from '../../i18n';
import { useToast } from '../../lib/toast';
import { useDialogs } from '../../lib/dialogs';
import { useAuth } from '../../lib/auth';
import { buildExtensions } from '../../editor/extensions';
import { useMentionFeedback, type MentionScope } from '../../editor/mentions';
import { DocContext } from '../../editor/context';
import { Avatar, Button, EmptyState, Loading, Time, cx } from '../../components/ui';
import { modKey } from '../../lib/utils';

export interface ComposerHandle {
  focus: () => void;
  setQuote: (quote: string) => void;
}

interface ComposerProps {
  placeholder: string;
  submitLabel: string;
  initial?: string;
  quote?: string | null;
  onSubmit: (html: string, quote: string | null) => Promise<void>;
  onCancel?: () => void;
  autofocus?: boolean;
  /** Wo wird geschrieben? Das Erwähnungsmenü zeigt dann Beteiligte zuerst und kennzeichnet fehlenden Zugriff. */
  mentionContext?: MentionScope;
}

/** Kleiner Rich-Text-Editor für Kommentare (inkl. @-Erwähnungen). */
export const CommentComposer = forwardRef<ComposerHandle, ComposerProps>(function CommentComposer(
  { placeholder, submitLabel, initial = '', quote: initialQuote = null, onSubmit, onCancel, autofocus, mentionContext },
  ref,
) {
  const { t, locale } = useI18n();
  const [busy, setBusy] = useState(false);
  const [empty, setEmpty] = useState(!initial);
  const [quote, setQuote] = useState<string | null>(initialQuote);
  const editorRef = useRef<Editor | null>(null);
  const { taskId: mentionTask, pageId: mentionPage } = mentionContext ?? {};
  const extensions = useMemo(
    () => buildExtensions({ mode: 'edit', t, minimal: true, placeholder, mentionContext: { taskId: mentionTask, pageId: mentionPage } }),
    [t, placeholder, mentionTask, mentionPage],
  );
  const editor = useEditor({
    extensions,
    content: initial,
    autofocus: autofocus ? 'end' : false,
    immediatelyRender: true,
    onUpdate: ({ editor: e }) => setEmpty(e.isEmpty),
    editorProps: {
      attributes: { role: 'textbox', 'aria-label': placeholder, 'aria-multiline': 'true' },
      handleKeyDown: (_view, event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
          void submit();
          return true;
        }
        return false;
      },
    },
  });
  editorRef.current = editor;

  useImperativeHandle(ref, () => ({
    focus: () => editor?.commands.focus('end'),
    setQuote: (q) => {
      setQuote(q);
      editor?.commands.focus('end');
    },
  }));

  const submit = async () => {
    const e = editorRef.current;
    if (!e || e.isEmpty || busy) return;
    setBusy(true);
    try {
      await onSubmit(e.getHTML(), quote);
      // Antwortfelder schließen sich nach dem Absenden – der Editor ist dann schon zerstört
      if (!e.isDestroyed) e.commands.clearContent(true);
      setQuote(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <DocContext.Provider value={{ mode: 'edit', pageId: null, spaceKey: null, depth: 0 }}>
      <div className="comment-composer">
        {quote && (
          <div className="row" style={{ padding: '0.5rem 0.75rem 0' }}>
            <div className="comment-quote grow">„{quote}“</div>
            <button type="button" className="icon-btn" onClick={() => setQuote(null)} aria-label={t('common.remove')}>
              <X size={14} />
            </button>
          </div>
        )}
        <div className="doc editing">
          <EditorContent editor={editor} />
        </div>
        <div className="comment-composer-footer">
          <span className="tiny faint grow">{modKey(locale)}+Enter</span>
          {onCancel && (
            <Button size="sm" variant="ghost" onClick={onCancel}>
              {t('common.cancel')}
            </Button>
          )}
          <Button size="sm" variant="primary" loading={busy} disabled={empty} onClick={() => void submit()}>
            {submitLabel}
          </Button>
        </div>
      </div>
    </DocContext.Provider>
  );
});

function CommentItem({ comment, page, onReply, depth }: { comment: Comment; page: Page; onReply: (c: Comment) => void; depth: number }) {
  const { t } = useI18n();
  const toast = useToast();
  const dialogs = useDialogs();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const mentions = useMentionFeedback();
  const refresh = () => qc.invalidateQueries({ queryKey: ['comments', page.id] });

  if (comment.deleted) {
    return (
      <div className="comment" id={`comment-${comment.id}`}>
        <Avatar user={null} size={28} />
        <div className="comment-body muted small">{t('comments.deleted')}</div>
      </div>
    );
  }
  return (
    <div className="comment" id={`comment-${comment.id}`}>
      <Avatar user={comment.author} size={28} />
      <div className="comment-body">
        <div className="comment-head">
          {comment.author ? (
            <Link to={`/people/${encodeURIComponent(comment.author.username)}`} className="comment-author">
              {comment.author.displayName}
            </Link>
          ) : (
            <span className="comment-author">?</span>
          )}
          <span className="muted small">
            <Time value={comment.createdAt} />
          </span>
          {comment.edited && <span className="faint tiny">({t('comments.edited')})</span>}
        </div>
        {comment.quote && <div className="comment-quote">„{comment.quote}“</div>}
        {editing ? (
          <CommentComposer
            placeholder={t('comments.placeholder')}
            submitLabel={t('common.save')}
            initial={comment.body}
            autofocus
            mentionContext={{ pageId: page.id }}
            onCancel={() => setEditing(false)}
            onSubmit={async (html) => {
              try {
                const saved = await api.patch<{ notNotified?: UserRef[] }>(`/api/v1/comments/${comment.id}`, { body: html });
                mentions.warn(saved.notNotified);
                setEditing(false);
                await refresh();
              } catch (err) {
                toast.error(err);
              }
            }}
          />
        ) : (
          <div className="comment-text" onClick={mentions.open} dangerouslySetInnerHTML={{ __html: comment.body }} />
        )}
        {!editing && (
          <div className="comment-actions">
            {comment.can.reply && depth < 3 && (
              <Button size="sm" variant="ghost" icon={CornerDownRight} onClick={() => onReply(comment)}>
                {t('comments.reply')}
              </Button>
            )}
            {comment.can.edit && (
              <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(true)}>
                {t('common.edit')}
              </Button>
            )}
            {comment.can.resolve && (
              <Button
                size="sm"
                variant="ghost"
                icon={comment.resolved ? RotateCcw : Check}
                onClick={async () => {
                  try {
                    await api.post(`/api/v1/comments/${comment.id}/resolve`, { resolved: !comment.resolved });
                    await refresh();
                  } catch (err) {
                    toast.error(err);
                  }
                }}
              >
                {comment.resolved ? t('comments.reopen') : t('comments.resolve')}
              </Button>
            )}
            {comment.can.delete && (
              <Button
                size="sm"
                variant="ghost"
                icon={Trash2}
                aria-label={t('common.delete')}
                onClick={async () => {
                  if (!(await dialogs.confirm({ title: t('comments.deleteConfirm'), danger: true, confirmLabel: t('common.delete') }))) return;
                  try {
                    await api.del(`/api/v1/comments/${comment.id}`);
                    await refresh();
                  } catch (err) {
                    toast.error(err);
                  }
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Thread({ comment, page, depth = 0 }: { comment: Comment; page: Page; depth?: number }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const mentions = useMentionFeedback();
  const [replying, setReplying] = useState(false);
  return (
    <>
      <CommentItem comment={comment} page={page} depth={depth} onReply={() => setReplying(true)} />
      {(comment.replies.length > 0 || replying) && (
        <div className="comment-replies">
          {comment.replies.map((r) => (
            <Thread key={r.id} comment={r} page={page} depth={depth + 1} />
          ))}
          {replying && (
            <CommentComposer
              autofocus
              placeholder={t('comments.replyPlaceholder')}
              submitLabel={t('comments.reply')}
              mentionContext={{ pageId: page.id }}
              onCancel={() => setReplying(false)}
              onSubmit={async (html) => {
                try {
                  const saved = await api.post<Comment>(`/api/v1/pages/${page.id}/comments`, { body: html, parentId: comment.id });
                  mentions.warn(saved.notNotified);
                  setReplying(false);
                  await qc.invalidateQueries({ queryKey: ['comments', page.id] });
                } catch (err) {
                  toast.error(err);
                }
              }}
            />
          )}
        </div>
      )}
      {comment.resolved && depth === 0 && (
        <div className="tiny muted mt-1">
          <Check size={12} /> {t('comments.resolved', { user: comment.resolvedBy?.displayName ?? '' })} · <Time value={comment.resolvedAt} />
        </div>
      )}
    </>
  );
}

export const CommentsPanel = forwardRef<ComposerHandle, { page: Page }>(function CommentsPanel({ page }, ref) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const mentions = useMentionFeedback();
  const { data, isLoading } = useComments(page.id);
  const [showResolved, setShowResolved] = useState(false);
  const open = (data ?? []).filter((c) => !c.resolved);
  const resolved = (data ?? []).filter((c) => c.resolved);
  const total = (data ?? []).reduce(function count(n: number, c: Comment): number {
    return c.replies.reduce(count, n + (c.deleted ? 0 : 1));
  }, 0);

  return (
    <section className="panel" id="comments">
      <h2 className="panel-title">
        <MessageSquare size={17} />
        {t('comments.title')}
        {total > 0 && <span className="count">{total}</span>}
        <span className="spacer" />
        {resolved.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setShowResolved((s) => !s)}>
            {showResolved ? t('comments.hideResolved') : t('comments.showResolved', { n: resolved.length })}
          </Button>
        )}
      </h2>
      {isLoading ? (
        <Loading inline />
      ) : (
        <div className="col gap-lg">
          {open.length === 0 && !showResolved && <EmptyState compact icon={MessageSquare} title={t('comments.empty')} />}
          {open.map((c) => (
            <div key={c.id} className="comment-thread">
              <Thread comment={c} page={page} />
            </div>
          ))}
          {showResolved &&
            resolved.map((c) => (
              <div key={c.id} className={cx('comment-thread', 'resolved')}>
                <Thread comment={c} page={page} />
              </div>
            ))}
          {user && page.access.comment ? (
            <CommentComposer
              ref={ref}
              placeholder={t('comments.placeholder')}
              submitLabel={t('comments.submit')}
              mentionContext={{ pageId: page.id }}
              onSubmit={async (html, quote) => {
                try {
                  const saved = await api.post<Comment>(`/api/v1/pages/${page.id}/comments`, { body: html, quote });
                  mentions.warn(saved.notNotified);
                  await qc.invalidateQueries({ queryKey: ['comments', page.id] });
                  void qc.invalidateQueries({ queryKey: ['page', page.id] });
                } catch (err) {
                  toast.error(err);
                  throw err;
                }
              }}
            />
          ) : (
            user && <div className="small muted">{t('comments.noPermission')}</div>
          )}
        </div>
      )}
    </section>
  );
});
