/** Typen der API-Antworten (spiegeln die DTOs des Servers). */

export type ContentType = 'richtext' | 'markdown' | 'code';
export type SpaceRole = 'viewer' | 'commenter' | 'editor' | 'admin';

export interface UserRef {
  id: number;
  username: string;
  displayName: string;
  avatarColor: string | null;
}

/** Vorschlag im Erwähnungsmenü. Mit Zusammenhang (Aufgabe, Seite) nennt der Server Beteiligte und Zugriff. */
export interface MentionCandidate extends UserRef {
  /** false: Die Person darf den Ort nicht sehen – eine Erwähnung erreicht sie nicht */
  access?: boolean;
  involved?: boolean;
}

export interface User extends UserRef {
  email: string | null;
  kind: 'user' | 'bot';
  status: 'active' | 'disabled';
  bio: string;
  createdAt: string;
  lastLoginAt: string | null;
  groups?: { id: number; name: string }[];
  isAdmin?: boolean;
}

export interface Me extends User {
  preferences: Preferences;
  permissions: string[];
  /** lokales Passwort vorhanden – Änderungen der E-Mail-Adresse verlangen es */
  hasPassword?: boolean;
}

export interface Preferences {
  theme?: 'light' | 'dark' | 'system';
  locale?: 'de' | 'en';
  autoWatch?: boolean;
  emailNotifications?: boolean;
  emailMode?: 'instant' | 'daily' | 'off';
  /** Vorlauf für Aufgaben-Erinnerungen in Tagen (-1 = keine) */
  taskReminderDays?: number;
  emailOnlyMentions?: boolean;
  editorWidth?: 'normal' | 'wide';
  /** Bewegung und 3D-Effekte: eigene Wahl; ohne Angabe gilt die Vorgabe der Installation */
  motion?: 'full' | 'reduced';
  /** Aussehen der Oberfläche (unabhängig von hell/dunkel) */
  appearance?: 'classic' | 'glass' | 'paper' | 'frost'; // 'glass' nur noch aus alten Konten; gilt als 'frost'
  sidebarCollapsed?: boolean;
  defaultContentType?: ContentType;
  [key: string]: unknown;
}

export interface PublicSettings {
  drawioUrl: string;
  /** Gleichzeitiges Bearbeiten in Echtzeit */
  realtimeCollaboration: boolean;
  siteName: string;
  siteTagline: string;
  accentColor: string;
  /** Vorgabe für Bewegung und 3D-Effekte (jede Person kann sie für sich ändern) */
  uiMotion: 'full' | 'reduced';
  defaultLocale: 'de' | 'en';
  allowRegistration: boolean;
  anonymousAccess: boolean;
  footerText: string;
  passwordMinLength: number;
  personalSpaces: boolean;
  maxUploadMb: number;
  allowedEmbedHosts: string[];
}

export type SsoProviderId = 'oidc' | 'saml' | 'kerberos';

/** Anmeldewege über Single Sign-on */
export interface SsoInfo {
  providers: { id: SsoProviderId; label: string; kind?: 'entra' | 'generic' }[];
  /** Anmeldeformular für lokale Konten gleich sichtbar */
  showLocalLogin: boolean;
  /** Windows-Anmeldung beim Öffnen der Anmeldeseite selbstständig versuchen */
  kerberosAuto: boolean;
}

export interface LinkedIdentity {
  id: number;
  provider: SsoProviderId;
  label: string;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface MeResponse {
  user: Me | null;
  settings: PublicSettings;
  version: string;
  needsSetup: boolean;
  /** Ersteinrichtung von einem anderen Rechner: Einrichtungscode aus dem Serverprotokoll nötig */
  setupCodeRequired?: boolean;
  mailConfigured: boolean;
  personalSpaceKey?: string | null;
  unreadNotifications?: number;
  openReviews?: number;
  openTasks?: number;
  /** fällige Wiedervorlagen, für die man verantwortlich ist */
  dueReviews?: number;
  /** offene oder überfällige Lesebestätigungen */
  openReads?: number;
  aiAvailable?: boolean;
  /** E-Mail-Benachrichtigungen sind eingerichtet und global aktiv */
  emailNotificationsEnabled?: boolean;
  /** Anmeldung über Active Directory/LDAP ist eingerichtet */
  directoryLogin?: boolean;
  sso?: SsoInfo;
  via?: string;
}

export interface SpaceCategory {
  id: number;
  name: string;
  icon: string | null;
  description: string;
  position: number;
  spaceCount: number;
}

export interface Space {
  id: number;
  key: string;
  name: string;
  description: string;
  icon: string | null;
  color: string | null;
  kind: 'team' | 'personal';
  ownerId: number | null;
  homePageId: number | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  category: string;
  reviewRequired: boolean;
  /** Bearbeitungsmodus neuer Rich-Text-Seiten */
  defaultEditMode?: 'direct' | 'suggest';
  role: SpaceRole | null;
  can: { view: boolean; create: boolean; comment: boolean; admin: boolean; purge: boolean; export: boolean };
  pageCount?: number;
  isWatching?: boolean;
  lastActivityAt?: string | null;
}

export interface TreeNode {
  id: number;
  parentId: number | null;
  title: string;
  icon: string | null;
  position: number;
  contentType: ContentType;
  restricted: boolean;
  updatedAt: string;
}

export interface PageAccess {
  view: boolean;
  export: boolean;
  comment: boolean;
  edit: boolean;
  create: boolean;
  move: boolean;
  delete: boolean;
  attach: boolean;
  restrict: boolean;
  moderate: boolean;
  purge: boolean;
  admin: boolean;
}

export interface Property {
  name: string;
  value: string;
  type: string;
}

export interface PresenceUser extends UserRef {
  mode: 'view' | 'edit';
}

export interface ReviewCycle {
  owner: UserRef | null;
  intervalMonths: number;
  pageIntervalMonths: number | null;
  spaceIntervalMonths: number;
  verifiedAt: string | null;
  verifiedBy: UserRef | null;
  dueAt: string | null;
  state: 'none' | 'ok' | 'due' | 'overdue';
  responsible: UserRef | null;
  canVerify: boolean;
  canConfigure: boolean;
}

export interface Page {
  id: number;
  spaceId: number;
  space: { id: number; key: string; name: string; icon: string | null; color: string | null; homePageId: number | null; archived: boolean; kind: string };
  parentId: number | null;
  title: string;
  icon: string | null;
  contentType: ContentType;
  language: string | null;
  content: string;
  html?: string;
  excerpt: string;
  status: 'current' | 'draft';
  version: number;
  fullWidth: boolean;
  isHome: boolean;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  deletedAt: string | null;
  createdBy: UserRef | null;
  updatedBy: UserRef | null;
  ancestors: { id: number; title: string; icon: string | null }[];
  labels: string[];
  properties: Property[];
  restrictions: { view: boolean; edit: boolean; inheritedView: boolean };
  access: PageAccess;
  isFavorite: boolean;
  isWatching: boolean;
  childCount: number;
  /** Gemeinsame Bearbeitung: aktive Personen und unveröffentlichte Änderungen */
  collab?: { editors: { id: number; name: string; color: string }[]; unpublished: boolean };
  attachmentCount: number;
  commentCount: number;
  viewCount: number;
  tasks: { total: number; done: number };
  hasDraft: boolean;
  url: string;
  review: PageReview;
  reviewCycle: ReviewCycle;
  /** Von der angemeldeten Person verlangte Lesebestätigung */
  readConfirmation: ReadState | null;
  /** Bearbeitungsmodus (direkt oder nur Vorschläge) */
  editMode: PageEditMode;
  presence?: PresenceUser[];
}

export type ReviewStatus = 'open' | 'approved' | 'rejected' | 'cancelled';

export interface PageReview {
  status: 'none' | 'pending' | 'approved' | 'rejected';
  openId: number | null;
  approvedVersion: number | null;
  approvedAt: string | null;
  approvedBy: UserRef | null;
  canDecide: boolean;
  required: boolean;
}

export interface Review {
  id: number;
  pageId: number;
  page: { id: number; title: string; icon: string | null; url: string; spaceKey: string; spaceName: string } | null;
  version: number;
  currentVersion: number;
  status: ReviewStatus;
  requestedBy: UserRef | null;
  reviewer: UserRef | null;
  note: string;
  decisionNote: string;
  decidedBy: UserRef | null;
  createdAt: string;
  decidedAt: string | null;
  canDecide: boolean;
  /** Mehrstufiger Freigabeablauf (null bei einfacher Prüfung) */
  workflow: ReviewWorkflow | null;
}

export interface ReviewWorkflow {
  currentStage: number;
  stageStartedAt: string | null;
  distinctApprovers: boolean;
  /** Die angemeldete Person entscheidet in Vertretung für … */
  onBehalfOf: UserRef | null;
  blockedReason: string | null;
  stages: {
    name: string;
    minApprovals: number;
    escalateDays: number;
    approvers: { type: 'group' | 'user'; id: number; label: string }[];
    state: 'done' | 'current' | 'pending' | 'rejected' | 'cancelled';
    decisions: { user: UserRef | null; onBehalfOf: UserRef | null; decision: 'approved' | 'rejected'; note: string; createdAt: string }[];
  }[];
}

export interface ApprovalStage {
  name: string;
  approvers: { type: 'group' | 'user'; id: number; label: string }[];
  minApprovals: number;
  escalateDays: number;
}

export interface ApprovalWorkflow {
  canEdit: boolean;
  enabled: boolean;
  distinctApprovers: boolean;
  stages: ApprovalStage[];
  updatedAt: string | null;
  updatedBy: UserRef | null;
}

export interface DeputyEntry {
  id: number;
  user: UserRef | null;
  deputy: UserRef | null;
  startsOn: string;
  endsOn: string;
  note: string;
  active: boolean;
}

/** Eintrag der Liste „Letzte Änderungen“ (mit Wiederherstellungspunkt). */
export interface ChangeEntry extends Revision {
  pageId: number;
  pageTitle: string;
  pageIcon: string | null;
  spaceKey: string;
  spaceName: string;
  url: string;
  deleted: boolean;
  previousVersion: number | null;
  canRestore: boolean;
}

export interface PageSummary {
  id: number;
  title: string;
  icon: string | null;
  spaceId: number;
  spaceKey: string;
  spaceName: string;
  parentId: number | null;
  excerpt: string;
  contentType: ContentType;
  status: 'current' | 'draft';
  version: number;
  updatedAt: string;
  createdAt: string;
  updatedBy: UserRef | null;
  url: string;
  viewedAt?: string | null;
  path?: string[];
  children?: PageSummary[];
  kind?: 'new' | 'edit';
  draftUpdatedAt?: string;
}

export interface Revision {
  id: number;
  version: number;
  title: string;
  contentType: string;
  changeNote: string;
  changeType: string;
  minor: boolean;
  size: number;
  author: UserRef | null;
  createdAt: string;
  isCurrent: boolean;
}

export interface RevisionDetail extends Revision {
  content: string;
  language: string | null;
  html: string;
  spaceKey: string;
}

export interface DiffResult {
  from: Revision;
  to: Revision;
  titleChanged: boolean;
  html: string | null;
  lines: { type: 'equal' | 'add' | 'del'; text: string }[];
  stats: { added: number; removed: number };
}

export interface Comment {
  id: number;
  pageId: number;
  parentId: number | null;
  author: UserRef | null;
  body: string;
  quote: string | null;
  resolved: boolean;
  resolvedAt: string | null;
  resolvedBy: UserRef | null;
  createdAt: string;
  updatedAt: string;
  edited: boolean;
  deleted: boolean;
  can: { edit: boolean; delete: boolean; resolve: boolean; reply: boolean };
  replies: Comment[];
  /** Nur in der Antwort auf das Anlegen: Erwähnte ohne Zugriff, die nicht benachrichtigt wurden */
  notNotified?: UserRef[];
}

export interface Attachment {
  id: number;
  pageId: number;
  filename: string;
  version: number;
  mimeType: string;
  size: number;
  comment: string;
  uploadedBy: UserRef | null;
  createdAt: string;
  deletedAt: string | null;
  url: string;
  downloadUrl: string;
  isImage: boolean;
  /** Im Browser als PDF darstellbar (direkt oder über die Office-Vorschau) */
  preview: 'pdf' | 'office' | null;
  previewUrl: string | null;
  versions?: Attachment[];
}

export interface Template {
  id: number;
  spaceId: number | null;
  spaceKey: string | null;
  name: string;
  description: string;
  icon: string | null;
  category: string;
  titlePattern: string;
  contentType: ContentType;
  content?: string;
  labels: string[];
  properties: { name: string; value: string; type?: string }[];
  builtin: boolean;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
}

export interface Activity {
  id: number;
  type: string;
  label: string;
  category: string;
  actor: UserRef | null;
  actorName: string | null;
  space: { key: string; name: string; icon: string | null } | null;
  page: { id: number; title: string; url: string; deleted: boolean } | null;
  target: { type: string; id: string; label: string | null } | null;
  data: Record<string, any>;
  createdAt: string;
  ip?: string | null;
  userAgent?: string | null;
}

export interface ChangelogEntry {
  kind: 'revision' | 'event';
  id: string;
  createdAt: string;
  actor: UserRef | null;
  page: { id: number; title: string; url: string; deleted: boolean };
  version?: number;
  changeType: string;
  changeNote: string;
  minor: boolean;
  label: string;
}

export interface Notification {
  id: number;
  type: string;
  actor: UserRef | null;
  spaceId: number | null;
  pageId: number | null;
  commentId: number | null;
  title: string;
  body: string;
  link: string;
  read: boolean;
  createdAt: string;
}

export interface SearchHit {
  id: number;
  title: string;
  icon: string | null;
  spaceKey: string;
  spaceName: string;
  url: string;
  snippet: string;
  contentType: string;
  updatedAt: string;
  updatedBy: UserRef | null;
  labels: string[];
  path: string[];
}

export interface SearchResult {
  items: SearchHit[];
  total: number;
  limit: number;
  offset: number;
  facets: {
    spaces: { key: string; name: string; icon: string | null; count: number }[];
    labels: { name: string; count: number }[];
    types: { type: string; count: number }[];
  };
  attachments: { id: number; filename: string; mimeType: string; size: number; createdAt: string; page: { id: number; title: string; url: string }; snippet: string | null }[];
  /** Treffer im Aufgabenplaner */
  tasks: {
    id: number;
    title: string;
    boardId: number;
    boardName: string;
    spaceKey: string;
    spaceName: string;
    status: TaskStatus;
    dueDate: string | null;
    overdue: boolean;
    assignee: UserRef | null;
    labels: string[];
    /** passende Nachricht im Chat der Aufgabe – Auszug als HTML (maskiert, Treffer in <mark>) */
    chat: { id: number; author: UserRef | null; createdAt: string; snippet: string } | null;
    url: string;
  }[];
}

export interface Group {
  id: number;
  name: string;
  description: string;
  permissions: string[];
  isSystem: boolean;
  isDefault: boolean;
  memberCount: number;
  createdAt: string;
  directoryGroups: string[];
  syncEnabled: boolean;
}

export interface SpaceGrant {
  subjectType: 'user' | 'group' | 'authenticated' | 'anonymous';
  subjectId: number;
  role: SpaceRole;
  label?: string;
  detail?: string;
}

export interface Subject {
  type: 'user' | 'group';
  id: number;
  label?: string;
  detail?: string;
}

export interface ApiToken {
  id: number;
  userId: number;
  name: string;
  prefix: string;
  scopes: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  revokedAt: string | null;
  createdAt: string;
  user?: { id: number; username: string; displayName: string };
}

export interface Session {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

export interface Webhook {
  id: number;
  name: string;
  url: string;
  events: string[];
  spaceId: number | null;
  spaceKey: string | null;
  headers: Record<string, string>;
  active: boolean;
  failureCount: number;
  lastStatus: number | null;
  lastDeliveryAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDelivery {
  id: number;
  eventType: string;
  payload: unknown;
  status: number | null;
  response: string | null;
  error: string | null;
  durationMs: number | null;
  attempt: number;
  success: boolean;
  createdAt: string;
}

export interface Connector {
  id: number;
  key: string;
  name: string;
  description: string;
  baseUrl: string;
  authType: 'none' | 'bearer' | 'basic' | 'header' | 'query';
  authConfigured: boolean;
  authHint: string;
  headers: Record<string, string>;
  allowedPaths: string[];
  cacheTtl: number;
  timeoutMs: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectorResult {
  status: number;
  ok: boolean;
  contentType: string;
  data: unknown;
  fetchedAt: string;
  cached: boolean;
  url: string;
}

export interface PluginSettingDef {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'password' | 'number' | 'boolean' | 'select' | 'json';
  default?: unknown;
  help?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
}

export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  homepage: string;
  enabled: boolean;
  loaded: boolean;
  error: string | null;
  hasServer: boolean;
  hasClient: boolean;
  settingsSchema: PluginSettingDef[];
  settings: Record<string, unknown>;
}

export interface Backup {
  name: string;
  createdAt: string;
  size: number;
  dbSize: number;
  includesUploads: boolean;
  reason: string;
  version: string;
}

export interface Catalog {
  globalPermissions: Record<string, { label: string; description: string }>;
  spaceRoles: { role: SpaceRole; label: string; actions: string[] }[];
  events: { type: string; category: string; label: string }[];
  tokenScopes: Record<string, string>;
}

export interface Paged<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

/* ------------------------------------------------------------------ */
/* KI                                                                   */
/* ------------------------------------------------------------------ */

export type AiAction = 'summarize' | 'improve' | 'shorten' | 'translate' | 'tags' | 'title' | 'outline' | 'ask' | 'tasks';

export interface AiStatus {
  enabled: boolean;
  available: boolean;
  provider: string;
  model: string;
  actions: AiAction[];
  dailyLimit: number;
  usedToday: number;
  remaining: number | null;
}

export interface AiResult {
  action: AiAction;
  text: string;
  items?: string[];
  model: string;
  provider: string;
  usage: { inputTokens: number; outputTokens: number; durationMs: number };
  remaining: number | null;
}

/* ------------------------------------------------------------------ */
/* Aufgabenplaner                                                       */
/* ------------------------------------------------------------------ */

export interface Bucket {
  id: string;
  name: string;
  color?: string;
}

export interface Board {
  id: number;
  spaceId: number;
  spaceKey: string;
  spaceName: string;
  name: string;
  description: string;
  buckets: Bucket[];
  canEdit: boolean;
  /** Darf im Chat der Aufgaben schreiben (ab Rolle „Kommentieren“) */
  canComment: boolean;
  /** Abhängige Aufgaben automatisch verschieben */
  autoSchedule: boolean;
  counts: { total: number; done: number; overdue: number };
  createdAt: string;
}

/** Ein Plan als Projekt (Übersicht „Projekte“): Kennzahlen, nächster Termin und Beteiligte */
export interface Project extends Board {
  spaceIcon: string | null;
  spaceColor: string | null;
  summary: {
    doing: number;
    nextTask: { id: number; title: string; dueDate: string } | null;
    startDate: string | null;
    dueDate: string | null;
    assignees: UserRef[];
    assigneeCount: number;
    updatedAt: string | null;
  };
}

/** FS: Ende → Anfang, SS: Anfang → Anfang, FF: Ende → Ende, SF: Anfang → Ende */
export type DependencyType = 'FS' | 'SS' | 'FF' | 'SF';

export interface TaskDependency {
  taskId: number;
  title: string;
  /** Plan der anderen Aufgabe – Abhängigkeiten dürfen über Pläne hinweg gehen */
  boardId: number;
  boardName: string;
  status: TaskStatus;
  type: DependencyType;
  lagDays: number;
  violated: boolean;
}

export interface TaskDependencyInput {
  taskId: number;
  type: DependencyType;
  lagDays: number;
}

export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';
export type TaskStatus = 'open' | 'doing' | 'done';

export interface ChecklistItem {
  text: string;
  done: boolean;
}

export interface Task {
  id: number;
  boardId: number;
  boardName: string;
  spaceKey: string;
  spaceName: string;
  bucket: string;
  title: string;
  notes: string;
  assignee: UserRef | null;
  dueDate: string | null;
  startDate: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  progress: number;
  page: { id: number; title: string; url: string } | null;
  labels: string[];
  checklist: ChecklistItem[];
  position: number;
  createdBy: UserRef | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  overdue: boolean;
  recurrence: TaskRecurrence | null;
  seriesId: number | null;
  /** Fortschritt folgt der Checkliste statt dem Regler */
  progressFromChecklist: boolean;
  /** Nachrichten im Chat der Aufgabe */
  commentCount: number;
  /** davon für mich ungelesen (von anderen geschrieben, seit ich den Chat zuletzt offen hatte) */
  unreadComments: number;
  predecessors: TaskDependency[];
  successors: TaskDependency[];
  blocked: boolean;
}

/** Nachricht im Chat einer Aufgabe */
export interface TaskComment {
  id: number;
  taskId: number;
  author: UserRef | null;
  body: string;
  createdAt: string;
  updatedAt: string;
  edited: boolean;
  can: { edit: boolean; delete: boolean };
  /** Nur in der Antwort auf Schreiben und Bearbeiten: Erwähnte ohne Zugriff, die nicht benachrichtigt wurden */
  notNotified?: UserRef[];
}

export interface TaskRecurrence {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
}

/* ------------------------------------------------------------------ */
/* Zwischenablage                                                       */
/* ------------------------------------------------------------------ */

export interface Clip {
  id: number;
  title: string;
  kind: 'html' | 'text' | 'link';
  content: string;
  preview: string;
  pinned: boolean;
  source: { id: number; title: string; url: string } | null;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Lesebestätigungen                                                    */
/* ------------------------------------------------------------------ */

export type ReadStatus = 'confirmed' | 'open' | 'overdue';

export interface ReadState {
  status: ReadStatus;
  dueAt: string;
  statement: string;
  confirmedAt: string | null;
  confirmedVersion: number | null;
}

export interface ReadAudienceEntry {
  type: 'group' | 'user' | 'space';
  id: number;
}

export interface ReadRequirementInfo {
  canManage: boolean;
  active: boolean;
  me: ReadState | null;
  requirement: {
    audience: (ReadAudienceEntry & { label: string })[];
    statement: string;
    dueDays: number;
    reconfirmOnChange: boolean;
    repeatMonths: number;
    requiredVersion: number;
    cycleStartedAt: string;
    dueAt: string;
    nextCycleAt: string | null;
    createdBy: UserRef | null;
    counts: { total: number; confirmed: number; open: number; overdue: number; noAccess: number };
  } | null;
}

export interface ReadEvidence {
  page: { id: number; title: string; version: number };
  rows: {
    user: UserRef | null;
    userName: string;
    status: ReadStatus | 'former';
    confirmedAt: string | null;
    confirmedVersion: number | null;
    statement: string | null;
    noAccess: boolean;
  }[];
}

export interface PageEditMode {
  mode: 'direct' | 'suggest';
  locked: boolean;
  canChange: boolean;
  canResolve: boolean;
  /** Die angemeldete Person kann nur Vorschläge machen */
  forced: boolean;
  /** Anzahl offener Vorschläge */
  pending: number;
}

/** Administration → Einrichtung abschließen */
export interface SetupChecklistItem {
  id: 'address' | 'service' | 'mail' | 'backup' | 'users' | 'spaces' | 'login' | 'extras';
  state: 'done' | 'open' | 'optional';
  detail: string | null;
  link: string;
}

export interface SetupChecklist {
  items: SetupChecklistItem[];
  done: number;
  total: number;
  dismissed: boolean;
}
