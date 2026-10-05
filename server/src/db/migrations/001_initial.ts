import type { Migration } from '../migrate.ts';

/** Grundschema von Knowstead. Zeitstempel werden als ISO-8601-Strings (UTC) gespeichert. */
export const migration001: Migration = {
  version: 1,
  name: 'initial',
  up: (db) => {
    db.exec(`
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      -- ---------------------------------------------------------------
      -- Benutzer, Gruppen, Sitzungen, Tokens
      -- ---------------------------------------------------------------
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        email TEXT UNIQUE COLLATE NOCASE,
        display_name TEXT NOT NULL,
        password_hash TEXT,
        kind TEXT NOT NULL DEFAULT 'user' CHECK (kind IN ('user', 'bot')),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
        avatar_color TEXT,
        bio TEXT NOT NULL DEFAULT '',
        preferences TEXT NOT NULL DEFAULT '{}',
        failed_logins INTEGER NOT NULL DEFAULT 0,
        locked_until TEXT,
        last_login_at TEXT,
        password_changed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE groups (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        description TEXT NOT NULL DEFAULT '',
        permissions TEXT NOT NULL DEFAULT '[]',
        is_system INTEGER NOT NULL DEFAULT 0,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE group_members (
        group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        added_at TEXT NOT NULL,
        PRIMARY KEY (group_id, user_id)
      );
      CREATE INDEX idx_group_members_user ON group_members(user_id);

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        ip TEXT,
        user_agent TEXT,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX idx_sessions_user ON sessions(user_id);

      CREATE TABLE password_resets (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL,
        used_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE api_tokens (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        prefix TEXT NOT NULL,
        scopes TEXT NOT NULL DEFAULT '["read"]',
        expires_at TEXT,
        last_used_at TEXT,
        last_used_ip TEXT,
        revoked_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_api_tokens_user ON api_tokens(user_id);

      -- ---------------------------------------------------------------
      -- Bereiche (Spaces) und Berechtigungen
      -- ---------------------------------------------------------------
      CREATE TABLE spaces (
        id INTEGER PRIMARY KEY,
        key TEXT NOT NULL UNIQUE COLLATE NOCASE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        icon TEXT,
        color TEXT,
        kind TEXT NOT NULL DEFAULT 'team' CHECK (kind IN ('team', 'personal')),
        owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        home_page_id INTEGER,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT
      );

      CREATE TABLE space_permissions (
        space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
        subject_type TEXT NOT NULL CHECK (subject_type IN ('user', 'group', 'authenticated', 'anonymous')),
        subject_id INTEGER NOT NULL DEFAULT 0,
        role TEXT NOT NULL CHECK (role IN ('viewer', 'commenter', 'editor', 'admin')),
        PRIMARY KEY (space_id, subject_type, subject_id)
      );

      -- ---------------------------------------------------------------
      -- Seiten, Versionen, Entwürfe
      -- ---------------------------------------------------------------
      CREATE TABLE pages (
        id INTEGER PRIMARY KEY,
        space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
        parent_id INTEGER REFERENCES pages(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        icon TEXT,
        content_type TEXT NOT NULL DEFAULT 'richtext' CHECK (content_type IN ('richtext', 'markdown', 'code')),
        language TEXT,
        content TEXT NOT NULL DEFAULT '',
        content_text TEXT NOT NULL DEFAULT '',
        excerpt TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'current' CHECK (status IN ('current', 'draft')),
        version INTEGER NOT NULL DEFAULT 0,
        position INTEGER NOT NULL DEFAULT 0,
        full_width INTEGER NOT NULL DEFAULT 0,
        view_count INTEGER NOT NULL DEFAULT 0,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        published_at TEXT,
        deleted_at TEXT,
        deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        trash_root_id INTEGER
      );
      CREATE INDEX idx_pages_space_parent ON pages(space_id, parent_id, position);
      CREATE INDEX idx_pages_parent ON pages(parent_id);
      CREATE INDEX idx_pages_updated ON pages(updated_at);
      CREATE INDEX idx_pages_trash_root ON pages(trash_root_id);

      CREATE TABLE page_revisions (
        id INTEGER PRIMARY KEY,
        page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        title TEXT NOT NULL,
        content_type TEXT NOT NULL,
        language TEXT,
        content TEXT NOT NULL,
        change_note TEXT NOT NULL DEFAULT '',
        change_type TEXT NOT NULL DEFAULT 'edit',
        minor INTEGER NOT NULL DEFAULT 0,
        size INTEGER NOT NULL DEFAULT 0,
        author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        UNIQUE (page_id, version)
      );
      CREATE INDEX idx_revisions_created ON page_revisions(created_at);

      CREATE TABLE page_drafts (
        page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        content_type TEXT NOT NULL,
        language TEXT,
        base_version INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (page_id, user_id)
      );

      CREATE TABLE page_links (
        source_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        target_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        PRIMARY KEY (source_id, target_id)
      );
      CREATE INDEX idx_page_links_target ON page_links(target_id);

      CREATE TABLE page_restrictions (
        page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('view', 'edit')),
        subject_type TEXT NOT NULL CHECK (subject_type IN ('user', 'group')),
        subject_id INTEGER NOT NULL,
        PRIMARY KEY (page_id, kind, subject_type, subject_id)
      );

      CREATE TABLE labels (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE
      );

      CREATE TABLE page_labels (
        page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        label_id INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
        PRIMARY KEY (page_id, label_id)
      );
      CREATE INDEX idx_page_labels_label ON page_labels(label_id);

      CREATE TABLE page_properties (
        id INTEGER PRIMARY KEY,
        page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        value TEXT NOT NULL DEFAULT '',
        type TEXT NOT NULL DEFAULT 'text',
        position INTEGER NOT NULL DEFAULT 0,
        UNIQUE (page_id, name)
      );
      CREATE INDEX idx_page_properties_name ON page_properties(name, value);

      -- ---------------------------------------------------------------
      -- Kommentare, Anhänge
      -- ---------------------------------------------------------------
      CREATE TABLE comments (
        id INTEGER PRIMARY KEY,
        page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
        author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        body TEXT NOT NULL,
        quote TEXT,
        resolved_at TEXT,
        resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE INDEX idx_comments_page ON comments(page_id);

      CREATE TABLE attachments (
        id INTEGER PRIMARY KEY,
        page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        filename TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        mime_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        storage_key TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        comment TEXT NOT NULL DEFAULT '',
        uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE INDEX idx_attachments_page ON attachments(page_id, filename, version);

      -- ---------------------------------------------------------------
      -- Vorlagen, Favoriten, Beobachten, Aufrufe, Benachrichtigungen
      -- ---------------------------------------------------------------
      CREATE TABLE templates (
        id INTEGER PRIMARY KEY,
        space_id INTEGER REFERENCES spaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        icon TEXT,
        category TEXT NOT NULL DEFAULT '',
        title_pattern TEXT NOT NULL DEFAULT '',
        content_type TEXT NOT NULL DEFAULT 'richtext',
        content TEXT NOT NULL DEFAULT '',
        labels TEXT NOT NULL DEFAULT '[]',
        properties TEXT NOT NULL DEFAULT '[]',
        builtin_key TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE favorites (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (user_id, page_id)
      );

      CREATE TABLE watches (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        target_type TEXT NOT NULL CHECK (target_type IN ('page', 'space')),
        target_id INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (user_id, target_type, target_id)
      );
      CREATE INDEX idx_watches_target ON watches(target_type, target_id);

      CREATE TABLE page_views (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        count INTEGER NOT NULL DEFAULT 1,
        viewed_at TEXT NOT NULL,
        PRIMARY KEY (user_id, page_id)
      );
      CREATE INDEX idx_page_views_user ON page_views(user_id, viewed_at);

      CREATE TABLE notifications (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        space_id INTEGER,
        page_id INTEGER,
        comment_id INTEGER,
        title TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '',
        link TEXT NOT NULL DEFAULT '',
        read_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_notifications_user ON notifications(user_id, read_at, created_at);

      -- ---------------------------------------------------------------
      -- Ereignisse (Aktivität & Audit-Log)
      -- ---------------------------------------------------------------
      CREATE TABLE events (
        id INTEGER PRIMARY KEY,
        type TEXT NOT NULL,
        category TEXT NOT NULL,
        actor_id INTEGER,
        actor_name TEXT,
        space_id INTEGER,
        page_id INTEGER,
        target_type TEXT,
        target_id TEXT,
        target_label TEXT,
        data TEXT NOT NULL DEFAULT '{}',
        ip TEXT,
        user_agent TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_events_created ON events(created_at);
      CREATE INDEX idx_events_space ON events(space_id, created_at);
      CREATE INDEX idx_events_page ON events(page_id, created_at);
      CREATE INDEX idx_events_type ON events(type, created_at);
      CREATE INDEX idx_events_actor ON events(actor_id, created_at);
      CREATE INDEX idx_events_category ON events(category, created_at);

      -- ---------------------------------------------------------------
      -- Integrationen: Webhooks, API-Konnektoren, Plugins
      -- ---------------------------------------------------------------
      CREATE TABLE webhooks (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        secret TEXT NOT NULL,
        events TEXT NOT NULL DEFAULT '["*"]',
        space_id INTEGER REFERENCES spaces(id) ON DELETE CASCADE,
        headers TEXT NOT NULL DEFAULT '{}',
        active INTEGER NOT NULL DEFAULT 1,
        failure_count INTEGER NOT NULL DEFAULT 0,
        last_status INTEGER,
        last_delivery_at TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE webhook_deliveries (
        id INTEGER PRIMARY KEY,
        webhook_id INTEGER NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
        event_id INTEGER,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        status INTEGER,
        response TEXT,
        error TEXT,
        duration_ms INTEGER,
        attempt INTEGER NOT NULL DEFAULT 1,
        success INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_webhook_deliveries_hook ON webhook_deliveries(webhook_id, created_at);

      CREATE TABLE connectors (
        id INTEGER PRIMARY KEY,
        key TEXT NOT NULL UNIQUE COLLATE NOCASE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        base_url TEXT NOT NULL,
        auth_type TEXT NOT NULL DEFAULT 'none',
        auth_secret TEXT,
        headers TEXT NOT NULL DEFAULT '{}',
        allowed_paths TEXT NOT NULL DEFAULT '[]',
        cache_ttl INTEGER NOT NULL DEFAULT 300,
        timeout_ms INTEGER NOT NULL DEFAULT 10000,
        active INTEGER NOT NULL DEFAULT 1,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE plugins (
        id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 0,
        settings TEXT NOT NULL DEFAULT '{}',
        installed_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE plugin_storage (
        plugin_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (plugin_id, key)
      );

      -- ---------------------------------------------------------------
      -- Volltextsuche (rowid = pages.id)
      -- ---------------------------------------------------------------
      CREATE VIRTUAL TABLE pages_fts USING fts5(
        title,
        body,
        labels,
        tokenize = 'unicode61 remove_diacritics 2',
        prefix = '2 3 4'
      );
    `);
  },
};
