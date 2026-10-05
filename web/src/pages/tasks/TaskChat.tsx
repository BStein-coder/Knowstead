import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Pencil, Trash2 } from 'lucide-react';
import { api } from '../../api/client';
import type { Board, Task, TaskComment } from '../../api/types';
import { useI18n } from '../../i18n';
import { useToast } from '../../lib/toast';
import { useDialogs } from '../../lib/dialogs';
import { useAuth } from '../../lib/auth';
import { Avatar, IconButton, Loading, Time } from '../../components/ui';
import { CommentComposer } from '../page/Comments';
import { useMentionFeedback } from '../../editor/mentions';

/**
 * Chat einer Aufgabe: Nachrichten in zeitlicher Reihenfolge, darunter das Eingabefeld – derselbe kleine
 * Editor wie bei Seitenkommentaren, also mit @-Erwähnungen. Ergänzt die Beschreibung (das „Was“) um
 * das Gespräch (wer hat wann was gesagt). Neue Nachrichten anderer erscheinen über den Live-Strom.
 */
export function TaskChat({ board, task }: { board: Board; task: Task }) {
  const { t } = useI18n();
  const toast = useToast();
  const dialogs = useDialogs();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<number | null>(null);
  const mentions = useMentionFeedback();
  const mentionContext = { taskId: task.id };
  const query = useQuery({
    queryKey: ['task-comments', task.id],
    queryFn: () => api.get<{ items: TaskComment[] }>(`/api/v1/tasks/${task.id}/comments`),
  });
  const items = query.data?.items ?? [];
  const { user } = useAuth();
  // Aus der Suche: ?comment=… springt zur gefundenen Nachricht und hebt sie hervor
  const [params] = useSearchParams();
  const targetId = Number(params.get('comment')) || null;
  const target = targetId && items.some((m) => m.id === targetId) ? targetId : null;
  // Die Liste scrollt in der Seitenspalte selbst – neue Nachrichten stehen unten, dorthin springen
  const listRef = useRef<HTMLDivElement | null>(null);
  const shownTarget = useRef<number | null>(null);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    if (target && shownTarget.current !== target) {
      shownTarget.current = target;
      document.getElementById(`task-comment-${target}`)?.scrollIntoView({ block: 'center' });
      return;
    }
    list.scrollTo({ top: list.scrollHeight });
  }, [items.length, target]);

  // Wer den Chat vor sich hat, hat ihn gelesen: Lesestand melden, sobald Nachrichten anderer dazugekommen sind –
  // beim Öffnen und solange der Dialog offen ist. Danach die Karten neu laden, damit das Zeichen verschwindet.
  const newest = items.at(-1);
  const reported = useRef(0);
  const taskId = task.id;
  const boardId = board.id;
  const hadUnread = task.unreadComments > 0;
  useEffect(() => {
    if (!newest || !user || reported.current >= newest.id) return;
    const first = reported.current === 0;
    reported.current = newest.id;
    // Nur eigene Nachrichten und nichts Ungelesenes: Es gibt nichts zu melden
    if (newest.author?.id === user.id && !(first && hadUnread)) return;
    api
      .post(`/api/v1/tasks/${taskId}/comments/read`)
      .then(() => {
        void qc.invalidateQueries({ queryKey: ['board', boardId] });
        void qc.invalidateQueries({ queryKey: ['tasks'] });
      })
      .catch(() => {
        /* der Lesestand ist eine Annehmlichkeit – ein Fehler hier soll den Chat nicht stören */
      });
  }, [newest, user, taskId, boardId, hadUnread, qc]);
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['task-comments', task.id] });
    // Zähler auf der Karte
    void qc.invalidateQueries({ queryKey: ['board', board.id] });
    void qc.invalidateQueries({ queryKey: ['tasks'] });
  };

  const remove = async (message: TaskComment) => {
    if (!(await dialogs.confirm({ title: t('tasks.chatDeleteConfirm'), danger: true, confirmLabel: t('common.delete') }))) return;
    try {
      await api.del(`/api/v1/task-comments/${message.id}`);
      await refresh();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <section className="task-chat" aria-label={t('tasks.chat')}>
      <h3 className="task-chat-title">
        <MessageSquare size={15} /> {t('tasks.chat')}
        {items.length > 0 && <span className="muted"> ({items.length})</span>}
      </h3>
      {query.isLoading ? (
        <Loading />
      ) : items.length === 0 ? (
        <p className="small muted">{t('tasks.chatEmpty')}</p>
      ) : (
        <div className="task-chat-list" ref={listRef}>
          {items.map((m) => (
            <div className={m.id === target ? 'comment is-target' : 'comment'} key={m.id} id={`task-comment-${m.id}`}>
              <Avatar user={m.author} size={28} />
              <div className="comment-body">
                <div className="comment-head">
                  {m.author ? (
                    <Link to={`/people/${encodeURIComponent(m.author.username)}`} className="comment-author">
                      {m.author.displayName}
                    </Link>
                  ) : (
                    <span className="comment-author">?</span>
                  )}
                  <span className="muted small">
                    <Time value={m.createdAt} />
                  </span>
                  {m.edited && <span className="faint tiny">({t('comments.edited')})</span>}
                  <span className="spacer" />
                  {m.can.edit && editing !== m.id && <IconButton icon={Pencil} label={t('common.edit')} onClick={() => setEditing(m.id)} />}
                  {m.can.delete && <IconButton icon={Trash2} label={t('common.delete')} onClick={() => void remove(m)} />}
                </div>
                {editing === m.id ? (
                  <CommentComposer
                    placeholder={t('tasks.chatPlaceholder')}
                    submitLabel={t('common.save')}
                    initial={m.body}
                    autofocus
                    mentionContext={mentionContext}
                    onCancel={() => setEditing(null)}
                    onSubmit={async (html) => {
                      try {
                        const saved = await api.patch<TaskComment>(`/api/v1/task-comments/${m.id}`, { body: html });
                        mentions.warn(saved.notNotified);
                        setEditing(null);
                        await refresh();
                      } catch (err) {
                        toast.error(err);
                      }
                    }}
                  />
                ) : (
                  <div className="comment-text" onClick={mentions.open} dangerouslySetInnerHTML={{ __html: m.body }} />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {board.canComment ? (
        <CommentComposer
          placeholder={t('tasks.chatPlaceholder')}
          submitLabel={t('tasks.chatSend')}
          mentionContext={mentionContext}
          onSubmit={async (html) => {
            try {
              const saved = await api.post<TaskComment>(`/api/v1/tasks/${task.id}/comments`, { body: html });
              mentions.warn(saved.notNotified);
              await refresh();
            } catch (err) {
              toast.error(err);
            }
          }}
        />
      ) : (
        <p className="small muted">{t('tasks.chatNoPermission')}</p>
      )}
    </section>
  );
}
