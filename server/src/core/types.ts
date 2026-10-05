/** Zeilentypen der Datenbanktabellen (snake_case wie in SQLite). */

export interface UserRow {
  id: number;
  username: string;
  email: string | null;
  display_name: string;
  password_hash: string | null;
  kind: 'user' | 'bot';
  status: 'active' | 'disabled';
  avatar_color: string | null;
  bio: string;
  preferences: string;
  failed_logins: number;
  locked_until: string | null;
  last_login_at: string | null;
  password_changed_at: string | null;
  created_at: string;
  updated_at: string;
  /** 'local', 'ldap' (Verzeichnisanmeldung), 'oidc' oder 'saml' (Single Sign-on) */
  auth_source: string;
  external_id: string | null;
  external_dn: string | null;
  synced_at: string | null;
  /** gesetzt, solange eine Selbstregistrierung auf die Bestätigung der E-Mail-Adresse wartet */
  registration_pending_at: string | null;
}

export interface GroupRow {
  id: number;
  name: string;
  description: string;
  permissions: string;
  is_system: number;
  is_default: number;
  created_at: string;
  updated_at: string;
  /** Zugeordnete AD-/LDAP-Sicherheitsgruppen, eine je Zeile */
  directory_groups: string;
  sync_enabled: number;
}

export interface SpaceRow {
  id: number;
  key: string;
  name: string;
  description: string;
  icon: string | null;
  color: string | null;
  kind: 'team' | 'personal';
  owner_id: number | null;
  home_page_id: number | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  /** Frei wählbare Kategorie für die Gliederung der Bereichsliste */
  category: string;
  /** Änderungen müssen geprüft werden */
  review_required: number;
  default_edit_mode: 'direct' | 'suggest';
  /** Vorgabe für die Wiedervorlage in Monaten (0 = aus) */
  review_interval_months: number;
  /** Plan, in dem überfällige Wiedervorlagen als Aufgabe landen */
  review_board_id: number | null;
}

export type ContentType = 'richtext' | 'markdown' | 'code';

export interface PageRow {
  id: number;
  space_id: number;
  parent_id: number | null;
  title: string;
  icon: string | null;
  content_type: ContentType;
  language: string | null;
  content: string;
  content_text: string;
  excerpt: string;
  status: 'current' | 'draft';
  version: number;
  position: number;
  full_width: number;
  view_count: number;
  created_by: number | null;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  deleted_at: string | null;
  deleted_by: number | null;
  trash_root_id: number | null;
  review_status: 'none' | 'pending' | 'approved' | 'rejected';
  approved_version: number | null;
  approved_at: string | null;
  approved_by: number | null;
  /** verantwortliche Person (Wiedervorlage) */
  owner_id: number | null;
  /** NULL = Vorgabe des Bereichs, 0 = keine Wiedervorlage */
  review_interval_months: number | null;
  verified_at: string | null;
  verified_by: number | null;
  review_due_at: string | null;
  /** Bearbeitungsmodus: direkt oder nur Vorschläge */
  edit_mode: 'direct' | 'suggest';
  edit_mode_locked: number;
}

export interface RevisionRow {
  id: number;
  page_id: number;
  version: number;
  title: string;
  content_type: ContentType;
  language: string | null;
  content: string;
  change_note: string;
  change_type: string;
  minor: number;
  size: number;
  author_id: number | null;
  created_at: string;
}

export interface CommentRow {
  id: number;
  page_id: number;
  parent_id: number | null;
  author_id: number | null;
  body: string;
  quote: string | null;
  resolved_at: string | null;
  resolved_by: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface AttachmentRow {
  id: number;
  page_id: number;
  filename: string;
  version: number;
  mime_type: string;
  size: number;
  storage_key: string;
  sha256: string;
  comment: string;
  uploaded_by: number | null;
  created_at: string;
  deleted_at: string | null;
}

export interface TemplateRow {
  id: number;
  space_id: number | null;
  name: string;
  description: string;
  icon: string | null;
  category: string;
  title_pattern: string;
  content_type: ContentType;
  content: string;
  labels: string;
  properties: string;
  builtin_key: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface WebhookRow {
  id: number;
  name: string;
  url: string;
  secret: string;
  events: string;
  space_id: number | null;
  headers: string;
  active: number;
  failure_count: number;
  last_status: number | null;
  last_delivery_at: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface ConnectorRow {
  id: number;
  key: string;
  name: string;
  description: string;
  base_url: string;
  auth_type: 'none' | 'bearer' | 'basic' | 'header' | 'query';
  auth_secret: string | null;
  headers: string;
  allowed_paths: string;
  cache_ttl: number;
  timeout_ms: number;
  active: number;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface ApiTokenRow {
  id: number;
  user_id: number;
  name: string;
  token_hash: string;
  prefix: string;
  scopes: string;
  expires_at: string | null;
  last_used_at: string | null;
  last_used_ip: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface UserRef {
  id: number;
  username: string;
  displayName: string;
  avatarColor: string | null;
}
