import type { Migration } from '../migrate.ts';

/**
 * Erweiterung um KI-Anbindung (Protokoll), Aufgabenplaner (Boards + Aufgaben)
 * und persönliche Zwischenablage.
 */
export const migration003: Migration = {
  version: 3,
  name: 'ai_tasks_clips',
  up: (db) => {
    db.exec(`
      -- ---------------------------------------------------------------
      -- KI-Nutzung (Protokoll, Budget, Nachvollziehbarkeit)
      -- ---------------------------------------------------------------
      CREATE TABLE ai_usage (
        id INTEGER PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        page_id INTEGER,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        ok INTEGER NOT NULL DEFAULT 1,
        error TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_ai_usage_created ON ai_usage(created_at);
      CREATE INDEX idx_ai_usage_user ON ai_usage(user_id, created_at);

      -- ---------------------------------------------------------------
      -- Aufgabenplaner: ein Board je Plan, Spalten („Buckets“) als JSON
      -- ---------------------------------------------------------------
      CREATE TABLE task_boards (
        id INTEGER PRIMARY KEY,
        space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        buckets TEXT NOT NULL DEFAULT '[]',
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_task_boards_space ON task_boards(space_id);

      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY,
        board_id INTEGER NOT NULL REFERENCES task_boards(id) ON DELETE CASCADE,
        bucket TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        due_date TEXT,
        start_date TEXT,
        priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'doing', 'done')),
        progress INTEGER NOT NULL DEFAULT 0,
        page_id INTEGER REFERENCES pages(id) ON DELETE SET NULL,
        labels TEXT NOT NULL DEFAULT '[]',
        checklist TEXT NOT NULL DEFAULT '[]',
        position REAL NOT NULL DEFAULT 0,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE INDEX idx_tasks_board ON tasks(board_id, bucket, position);
      CREATE INDEX idx_tasks_assignee ON tasks(assignee_id, status);
      CREATE INDEX idx_tasks_due ON tasks(due_date);
      CREATE INDEX idx_tasks_page ON tasks(page_id);

      -- ---------------------------------------------------------------
      -- Persönliche Zwischenablage (Textbausteine, kopierte Abschnitte)
      -- ---------------------------------------------------------------
      CREATE TABLE clips (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL DEFAULT 'html' CHECK (kind IN ('html', 'text', 'link')),
        content TEXT NOT NULL,
        source_page_id INTEGER REFERENCES pages(id) ON DELETE SET NULL,
        pinned INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_clips_user ON clips(user_id, pinned DESC, created_at DESC);
    `);
  },
};
