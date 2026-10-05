import type { Migration } from '../migrate.ts';
import { htmlToText } from '../../core/html.ts';

/**
 * Chat je Aufgabe: durchsuchbar und mit Ungelesen-Stand.
 *
 * - `body_text` hält den reinen Text einer Nachricht. Die Suche über das HTML fände sonst auch Tag- und
 *   Attributnamen („span“, „mention“) – und Wörter nicht, die ein Tag unterbricht.
 * - `task_comment_reads` merkt je Person und Aufgabe, bis zu welcher Nachricht gelesen wurde.
 * - Was vor dieser Migration geschrieben wurde, gilt als gelesen: Sonst stünde nach dem Update an jeder
 *   Aufgabe mit Chat für alle ein Ungelesen-Zeichen.
 */
export const migration024: Migration = {
  version: 24,
  name: 'task_chat_search',
  up: (db) => {
    db.exec(`
      ALTER TABLE task_comments ADD COLUMN body_text TEXT NOT NULL DEFAULT '';
      CREATE TABLE task_comment_reads (
        task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        last_comment_id INTEGER NOT NULL DEFAULT 0,
        read_at TEXT NOT NULL,
        PRIMARY KEY (task_id, user_id)
      ) WITHOUT ROWID;
    `);
    let newest = 0;
    for (const row of db.all<{ id: number; body: string }>('SELECT id, body FROM task_comments ORDER BY id')) {
      db.run('UPDATE task_comments SET body_text = ? WHERE id = ?', htmlToText(row.body), row.id);
      newest = row.id;
    }
    db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', 'internal:taskChat:unreadBaseline', JSON.stringify(newest));
  },
};
