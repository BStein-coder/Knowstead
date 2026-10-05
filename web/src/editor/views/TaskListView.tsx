import { useState } from 'react';
import { Link } from 'react-router';
import type { NodeViewProps } from '@tiptap/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Circle, KanbanSquare, Plus } from 'lucide-react';
import { api } from '../../api/client';
import type { Board, Task } from '../../api/types';
import { useI18n } from '../../i18n';
import { useToast } from '../../lib/toast';
import { Avatar, Button, Field, Loading, Modal, Select, cx } from '../../components/ui';
import { DueBadge, PriorityBadge, TaskDialog } from '../../pages/tasks/TaskComponents';
import { useDoc } from '../context';
import { MacroFrame } from './MacroFrame';

/**
 * Makro „Aufgaben“: zeigt Aufgaben eines Plans direkt in der Seite – wahlweise
 * alle offenen oder nur die mit dieser Seite verknüpften – mit Abhaken.
 */
export function TaskListView(props: NodeViewProps) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const { pageId } = useDoc();
  const boardId = Number(props.node.attrs.boardId) || null;
  const filter = String(props.node.attrs.filter || 'open');
  const limit = Number(props.node.attrs.limit) || 10;
  const editable = props.editor.isEditable;
  const [config, setConfig] = useState(editable && !boardId);
  const [creating, setCreating] = useState(false);

  const boards = useQuery({ queryKey: ['boards', 'all'], queryFn: () => api.get<{ items: Board[] }>('/api/v1/boards'), enabled: config || !!boardId });
  const board = boards.data?.items.find((b) => b.id === boardId) ?? null;

  const tasks = useQuery({
    queryKey: ['tasks', 'macro', boardId, filter, pageId, limit],
    queryFn: () =>
      api.get<{ items: Task[] }>('/api/v1/tasks', {
        board: boardId ?? undefined,
        status: filter === 'all' ? undefined : 'open-all',
        page: filter === 'page' && pageId ? pageId : undefined,
        limit,
      }),
    enabled: !!boardId,
  });

  const toggle = useMutation({
    mutationFn: (task: Task) => api.patch<Task>(`/api/v1/tasks/${task.id}`, { status: task.status === 'done' ? 'open' : 'done' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['tasks'] }),
    onError: (err) => toast.error(err),
  });

  return (
    <MacroFrame props={props} title={board ? `${t('tasks.title')}: ${board.name}` : t('tasks.title')} icon={KanbanSquare} onConfigure={editable ? () => setConfig(true) : undefined}>
      {!boardId ? (
        <div className="macro-empty">{t('tasks.macroEmpty')}</div>
      ) : tasks.isLoading ? (
        <Loading inline />
      ) : (
        <>
          <ul className="macro-task-list">
            {(tasks.data?.items ?? []).map((task) => (
              <li key={task.id} className={cx(task.status === 'done' && 'done')}>
                <button
                  type="button"
                  className="icon-btn"
                  disabled={!board?.canEdit}
                  onClick={() => toggle.mutate(task)}
                  aria-label={task.status === 'done' ? t('tasks.reopen') : t('tasks.complete')}
                >
                  {task.status === 'done' ? <CheckCircle2 size={17} className="success" /> : <Circle size={17} />}
                </button>
                <span className="grow">{task.title}</span>
                <PriorityBadge priority={task.priority} />
                <DueBadge task={task} />
                {task.assignee && <Avatar user={task.assignee} size={20} title={task.assignee.displayName} />}
              </li>
            ))}
            {!tasks.data?.items.length && <li className="muted small">{t('tasks.noneFiltered')}</li>}
          </ul>
          <div className="row gap-sm" style={{ marginTop: '0.4rem' }}>
            {board && (
              <Link className="small" to={`/s/${encodeURIComponent(board.spaceKey)}/tasks?board=${board.id}`}>
                {t('tasks.openBoard')}
              </Link>
            )}
            <span className="spacer" />
            {board?.canEdit && (
              <Button size="sm" variant="ghost" icon={Plus} onClick={() => setCreating(true)}>
                {t('tasks.add')}
              </Button>
            )}
          </div>
        </>
      )}
      {creating && board && <TaskDialog board={board} task={null} pageId={filter === 'page' ? pageId : null} onClose={() => setCreating(false)} />}
      {editable && config && (
        <Modal
          open
          onClose={() => setConfig(false)}
          title={t('tasks.macroConfig')}
          size="sm"
          footer={
            <Button variant="primary" onClick={() => setConfig(false)}>
              {t('common.done')}
            </Button>
          }
        >
          <Field label={t('tasks.board')}>
            <Select value={boardId ? String(boardId) : ''} onChange={(e) => props.updateAttributes({ boardId: Number(e.target.value) || null })}>
              <option value="">{t('common.none')}</option>
              {(boards.data?.items ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.spaceName} · {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('tasks.macroFilter')}>
            <Select value={filter} onChange={(e) => props.updateAttributes({ filter: e.target.value })}>
              <option value="open">{t('tasks.filters.open')}</option>
              <option value="page">{t('tasks.macroPageOnly')}</option>
              <option value="all">{t('tasks.filters.all')}</option>
            </Select>
          </Field>
          <Field label={t('tasks.macroLimit')}>
            <Select value={String(limit)} onChange={(e) => props.updateAttributes({ limit: Number(e.target.value) })}>
              {[5, 10, 20, 50].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </Field>
          {!boards.data?.items.length && <p className="small muted">{t('tasks.macroNoBoards')}</p>}
        </Modal>
      )}
    </MacroFrame>
  );
}
