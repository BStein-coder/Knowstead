import type { MouseEvent } from 'react';
import { useNavigate } from 'react-router';
import type { UserRef } from '../api/types';
import { useI18n } from '../i18n';
import { useToast } from '../lib/toast';

/** Zusammenhang einer Erwähnung: Der Server stellt Beteiligte nach vorn und kennzeichnet, wer keinen Zugriff hat. */
export interface MentionScope {
  taskId?: number;
  pageId?: number;
}

/**
 * Rückmeldungen rund um Erwähnungen in gespeicherten Kommentaren und Chat-Nachrichten:
 * Hinweis, wenn eine Erwähnung jemanden nicht erreicht, und Sprung zum Profil beim Klick auf den Namen.
 */
export function useMentionFeedback() {
  const { t } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  return {
    /** Nach dem Speichern: Wer erwähnt wurde, den Ort aber nicht sehen darf, wurde nicht benachrichtigt. */
    warn(users?: UserRef[] | null): void {
      if (!users?.length) return;
      const names = users.map((u) => u.displayName).join(', ');
      toast.warning(t(users.length === 1 ? 'editor.mentionNotNotified' : 'editor.mentionNotNotifiedMany', { names }));
    },
    /** Klick auf eine Erwähnung im gespeicherten Text öffnet das Profil der Person. */
    open(event: MouseEvent<HTMLElement>): void {
      const mention = (event.target as HTMLElement).closest<HTMLElement>('.mention');
      if (mention?.dataset.id) navigate(`/people/${encodeURIComponent(mention.dataset.id)}`);
    },
  };
}
