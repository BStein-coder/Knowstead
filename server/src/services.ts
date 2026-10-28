import type { Config } from './config.ts';
import { Db } from './db/database.ts';
import { acquireInstanceLock, InstanceLockError, type InstanceLock } from './db/lock.ts';
import { openDatabase } from './db/upgrade.ts';
import { migrationStatus } from './db/migrate.ts';
import { hmacSha256 } from './core/crypto.ts';
import { SettingsService } from './core/settings.ts';
import { EventBus, type DomainEvent, type EmitInput } from './core/events.ts';
import { HookRegistry } from './core/hooks.ts';
import { clearUploadTemp } from './core/archive-entries.ts';
import { ProgramState, RUNNING_KEY, type RunningProgram } from './core/program.ts';
import { PermissionService, type AuthContext } from './core/permissions.ts';
import { Mailer } from './core/mailer.ts';
import { MailService } from './modules/mail/service.ts';
import { UserService } from './modules/users/service.ts';
import { GroupService } from './modules/groups/service.ts';
import { DirectoryService } from './modules/directory/service.ts';
import { SsoService } from './modules/auth/sso.ts';
import { AuthService } from './modules/auth/service.ts';
import { TokenService } from './modules/tokens/service.ts';
import { SpaceService } from './modules/spaces/service.ts';
import { CategoryService } from './modules/spaces/categories.ts';
import { PageService } from './modules/pages/service.ts';
import { DraftService } from './modules/pages/drafts.ts';
import { TrashService } from './modules/pages/trash.ts';
import { PageLinkService } from './modules/pages/links.ts';
import { TaskDependencyService } from './modules/tasks/dependencies.ts';
import { TaskTrashService } from './modules/tasks/trash.ts';
import { TaskCommentService } from './modules/tasks/comments.ts';
import { AnalyticsService } from './modules/analytics/service.ts';
import { ReadConfirmationService } from './modules/reads/service.ts';
import { ApprovalWorkflowService } from './modules/review/workflow.ts';
import { SuggestionService } from './modules/pages/suggestions.ts';
import { RevisionService } from './modules/pages/revisions.ts';
import { LabelService } from './modules/pages/labels.ts';
import { JournalService } from './modules/pages/journal.ts';
import { RestrictionService } from './modules/pages/restrictions.ts';
import { MacroService } from './modules/pages/macros.ts';
import { ReviewService } from './modules/review/service.ts';
import { ReviewCycleService } from './modules/pages/reviewcycle.ts';
import { AiService } from './modules/ai/service.ts';
import { TaskService } from './modules/tasks/service.ts';
import { CalendarService } from './modules/tasks/calendar.ts';
import { ClipService } from './modules/clips/service.ts';
import { SocialService } from './modules/social/service.ts';
import { SearchService } from './modules/search/service.ts';
import { CommentService } from './modules/comments/service.ts';
import { AttachmentService } from './modules/attachments/service.ts';
import { PreviewService } from './modules/attachments/preview.ts';
import { AttachmentTextService } from './modules/attachments/fulltext.ts';
import { TemplateService } from './modules/templates/service.ts';
import { NotificationService } from './modules/notifications/service.ts';
import { MentionService } from './modules/notifications/mentions.ts';
import { ActivityService } from './modules/activity/service.ts';
import { WebhookService } from './modules/webhooks/service.ts';
import { ConnectorService } from './modules/connectors/service.ts';
import { PluginManager } from './plugins/manager.ts';
import { BackupService } from './modules/admin/backups.ts';
import { AdminService } from './modules/admin/service.ts';
import { AlertService } from './modules/system/alerts.ts';
import { UpdateService } from './modules/system/updates.ts';
import { TransferService } from './modules/transfer/service.ts';
import { ExportService } from './modules/export/service.ts';
import { ImportJobService } from './modules/transfer/jobs.ts';
import { RealtimeHub } from './modules/realtime/hub.ts';
import { CollabService } from './modules/realtime/collab.ts';
import { ensureBaseData } from './seed/index.ts';

export interface Logger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
  debug(obj: unknown, msg?: string): void;
  child(bindings: Record<string, unknown>): Logger;
}

/**
 * Dienst-Container. Alle Fachdienste erhalten eine Referenz auf den Container
 * und greifen darüber auf andere Dienste zu (keine zirkulären Konstruktoren).
 */
export interface Services {
  config: Config;
  log: Logger;
  /** Läuft noch der Programmstand, der auf der Platte liegt? Hält außerdem die Worker startfähig. */
  program: ProgramState;
  db: Db;
  settings: SettingsService;
  events: EventBus;
  hooks: HookRegistry;
  perms: PermissionService;
  mailer: Mailer;
  mail: MailService;
  users: UserService;
  groups: GroupService;
  directory: DirectoryService;
  sso: SsoService;
  auth: AuthService;
  tokens: TokenService;
  spaces: SpaceService;
  categories: CategoryService;
  pages: PageService;
  drafts: DraftService;
  trash: TrashService;
  links: PageLinkService;
  taskDependencies: TaskDependencyService;
  taskTrash: TaskTrashService;
  taskComments: TaskCommentService;
  analytics: AnalyticsService;
  reads: ReadConfirmationService;
  approvals: ApprovalWorkflowService;
  suggestions: SuggestionService;
  revisions: RevisionService;
  labels: LabelService;
  journal: JournalService;
  restrictions: RestrictionService;
  macros: MacroService;
  reviews: ReviewService;
  reviewCycle: ReviewCycleService;
  ai: AiService;
  tasks: TaskService;
  calendar: CalendarService;
  clips: ClipService;
  social: SocialService;
  search: SearchService;
  comments: CommentService;
  attachments: AttachmentService;
  previews: PreviewService;
  attachmentText: AttachmentTextService;
  templates: TemplateService;
  notifications: NotificationService;
  mentions: MentionService;
  activity: ActivityService;
  webhooks: WebhookService;
  connectors: ConnectorService;
  plugins: PluginManager;
  backups: BackupService;
  /** Betriebswarnungen an die Administration (Sicherung, Speicherplatz, Neustart) */
  alerts: AlertService;
  /** Hinweis auf neue Versionen (nur auf Wunsch, Administration → Über) */
  updates: UpdateService;
  admin: AdminService;
  transfer: TransferService;
  exporter: ExportService;
  imports: ImportJobService;
  realtime: RealtimeHub;
  collab: CollabService;
  /** Sperre gegen einen zweiten Server auf derselben Datenbank (null: ohne Sperre, z. B. CLI neben laufendem Server) */
  instanceLock: InstanceLock | null;
  /** Ereignis im Namen des angemeldeten Benutzers auslösen (Akteur, IP, User-Agent). */
  emit(auth: AuthContext, input: EmitInput): DomainEvent;
}

export interface CreateServicesOptions {
  /**
   * `require` (Server): Sperre muss gelingen, sonst Abbruch.
   * `optional` (Kommandozeile): ohne Sperre weiter, solange keine Migration nötig ist.
   */
  instanceLock?: 'require' | 'optional';
}

export function consoleLogger(prefix = ''): Logger {
  const fmt = (obj: unknown, msg?: string) => {
    if (typeof obj === 'string') return `${prefix}${obj}`;
    const err = (obj as { err?: unknown })?.err;
    return `${prefix}${msg ?? ''}${err ? ` – ${err instanceof Error ? err.message : String(err)}` : ''}`;
  };
  return {
    info: (o, m) => console.log(fmt(o, m)),
    warn: (o, m) => console.warn(fmt(o, m)),
    error: (o, m) => console.error(fmt(o, m)),
    debug: () => {},
    child: (b) => consoleLogger(`${prefix}[${Object.values(b).join(',')}] `),
  };
}

/** Prüfwert des Serverschlüssels – erkennt einen geänderten KNOWSTEAD_SECRET bzw. verlorenen secret.key. */
const KEY_CHECK_KEY = 'security:keyCheck';

/**
 * Passt der Serverschlüssel zur Datenbank? Ein anderer Schlüssel machte verschlüsselt gespeicherte
 * Zugangsdaten unbemerkt unbrauchbar. `check` läuft vor Sicherung und Migrationen – mit falschem
 * Schlüssel verändert ein Update nichts; `store` hält den Prüfwert danach fest.
 */
function verifySecretKey(settings: SettingsService, secret: Buffer, log: Logger, mode: 'check' | 'store'): void {
  // Der Wert „doku-key-check“ stammt aus der Zeit vor der Umbenennung und bleibt für immer: Der Prüfwert steht
  // in jeder bestehenden Datenbank – ein anderer Text ließe den Server „Schlüssel passt nicht“ melden.
  const expected = hmacSha256(secret, 'doku-key-check').slice(0, 32);
  const stored = settings.getInternal<string | null>(KEY_CHECK_KEY, null);
  if (stored === expected) return;
  if (stored && process.env.KNOWSTEAD_ALLOW_KEY_CHANGE === '1') {
    if (mode === 'check') return;
    log.warn('Serverschlüssel wurde geändert (KNOWSTEAD_ALLOW_KEY_CHANGE=1): Gespeicherte Zugangsdaten (SMTP, Verzeichnis, KI, Konnektoren, Plugins) müssen neu eingetragen werden.');
  }
  if (!stored || process.env.KNOWSTEAD_ALLOW_KEY_CHANGE === '1') {
    if (mode === 'store') settings.setInternal(KEY_CHECK_KEY, expected);
    return;
  }
  throw new Error(
    'Der Serverschlüssel passt nicht zu dieser Datenbank (KNOWSTEAD_SECRET geändert oder data/secret.key ersetzt). ' +
      'Verschlüsselt gespeicherte Zugangsdaten wären sonst unbrauchbar. Bitte den bisherigen Schlüssel wiederherstellen – ' +
      'oder KNOWSTEAD_ALLOW_KEY_CHANGE=1 setzen, um den neuen Schlüssel bewusst zu übernehmen und die Zugangsdaten neu einzutragen.',
  );
}

export function createServices(config: Config, log: Logger, options: CreateServicesOptions = {}): Services {
  const s = {} as Services;
  s.config = config;
  s.log = log;
  s.program = new ProgramState(config, log);
  s.instanceLock = null;
  const lockMode = options.instanceLock ?? 'require';
  try {
    s.instanceLock = acquireInstanceLock(config.dbFile, lockMode === 'require' ? 10_000 : 0);
  } catch (err) {
    if (!(err instanceof InstanceLockError) || lockMode === 'require') throw err;
    // Kommandozeile neben laufendem Server: erlaubt, solange nichts migriert werden muss
    const probe = new Db(config.dbFile);
    try {
      if (migrationStatus(probe).pending.length) {
        throw new InstanceLockError(`${err.message} Für ausstehende Datenbankmigrationen muss der Server beendet sein.`);
      }
    } finally {
      probe.close();
    }
  }

  try {
    const opened = openDatabase(config.dbFile, {
      backupsDir: config.backupsDir,
      appVersion: config.version,
      log: (msg) => log.info(msg),
      allowDowngrade: process.env.KNOWSTEAD_ALLOW_DOWNGRADE === '1',
      skipBackup: process.env.KNOWSTEAD_SKIP_UPDATE_BACKUP === '1',
      beforeChanges: (db) => verifySecretKey(new SettingsService(db), config.secret, log, 'check'),
    });
    s.db = opened.db;
    s.settings = new SettingsService(s.db);
    verifySecretKey(s.settings, config.secret, log, 'store');
    initServices(s, log);
    if (opened.previousAppVersion !== config.version) {
      // Update einer bestehenden Datenbank (nicht die Ersteinrichtung)
      if (opened.previousAppVersion || opened.fromSchema > 0) {
        s.events.emit({
          type: 'system.updated',
          data: { from: opened.previousAppVersion, to: config.version, fromSchema: opened.fromSchema, toSchema: opened.toSchema, backup: opened.backup },
        });
        log.info(`Knowstead aktualisiert: ${opened.previousAppVersion ?? 'frühere Version'} → ${config.version}`);
        // Bis 1.9 hieß das Programm „Doku“. Trägt die Installation noch genau diesen Namen, zieht er beim Update
        // einmalig mit; ein selbst gewählter Name bleibt unangetastet.
        if (Number((opened.previousAppVersion ?? '1').split('.')[0]) < 2) {
          // (Wurde der Name nie geändert, steht er gar nicht in der Datenbank – dann gilt ohnehin die neue Vorgabe.)
          const named = s.db.value<number>("SELECT 1 FROM settings WHERE key = 'siteName'") === 1;
          if (!named || s.settings.get('siteName') === 'Doku') {
            if (named) s.settings.update({ siteName: 'Knowstead' });
            log.info('Name der Installation von „Doku“ auf „Knowstead“ umgestellt (änderbar unter Administration → Einstellungen)');
          }
          // Ebenso die mitgelieferte Beschreibung des Handbuch-Bereichs – eine selbst geschriebene bleibt
          for (const [before, after] of [
            ['Benutzer- und Administrationshandbuch für Doku.', 'Benutzer- und Administrationshandbuch für Knowstead.'],
            ['User and administration handbook for Doku.', 'User and administration handbook for Knowstead.'],
          ]) {
            s.db.run("UPDATE spaces SET description = ? WHERE key = 'HANDBUCH' AND description = ?", after, before);
          }
        }
      }
      s.settings.setInternal('app:version', config.version);
    }
    // Der Server (nicht die Kommandozeile daneben) hält fest, mit welchem Stand er läuft – `cli status` und
    // `doctor` erkennen daran ein Update, nach dem der Dienst nicht neu gestartet wurde.
    if (lockMode === 'require') {
      const running: RunningProgram = { version: config.version, builtAt: config.packageBuiltAt, startedAt: new Date().toISOString(), pid: process.pid };
      s.settings.setInternal(RUNNING_KEY, running);
    }
  } catch (err) {
    try {
      s.db?.close();
    } catch {
      /* bereits geschlossen */
    }
    s.instanceLock?.release();
    throw err;
  }
  return s;
}

function initServices(s: Services, log: Logger): void {
  s.events = new EventBus(s.db, (err, event) => log.error({ err, event: event.type }, 'Fehler in Ereignis-Handler'));
  s.hooks = new HookRegistry();
  s.perms = new PermissionService(s.db, s.settings);
  s.mailer = new Mailer(s.settings, s.config.secret);
  s.mail = new MailService(s);
  s.emit = (auth, input) =>
    s.events.emit({
      ...input,
      actor: input.actor ?? (auth.user ? { id: auth.user.id, username: auth.user.username, displayName: auth.user.displayName } : null),
      ip: input.ip ?? auth.ip,
      userAgent: input.userAgent ?? auth.userAgent,
    });

  s.users = new UserService(s);
  s.groups = new GroupService(s);
  s.directory = new DirectoryService(s);
  s.sso = new SsoService(s);
  s.auth = new AuthService(s);
  s.tokens = new TokenService(s);
  s.spaces = new SpaceService(s);
  s.categories = new CategoryService(s);
  s.pages = new PageService(s);
  s.drafts = new DraftService(s);
  s.trash = new TrashService(s);
  s.links = new PageLinkService(s);
  s.taskDependencies = new TaskDependencyService(s);
  s.taskTrash = new TaskTrashService(s);
  s.taskComments = new TaskCommentService(s);
  s.analytics = new AnalyticsService(s);
  s.reads = new ReadConfirmationService(s);
  s.approvals = new ApprovalWorkflowService(s);
  s.suggestions = new SuggestionService(s);
  s.revisions = new RevisionService(s);
  s.labels = new LabelService(s);
  s.journal = new JournalService(s);
  s.restrictions = new RestrictionService(s);
  s.macros = new MacroService(s);
  s.reviews = new ReviewService(s);
  s.reviewCycle = new ReviewCycleService(s);
  s.ai = new AiService(s);
  s.tasks = new TaskService(s);
  s.calendar = new CalendarService(s);
  s.clips = new ClipService(s);
  s.social = new SocialService(s);
  s.search = new SearchService(s);
  s.comments = new CommentService(s);
  s.attachments = new AttachmentService(s);
  s.previews = new PreviewService(s);
  s.attachmentText = new AttachmentTextService(s);
  s.templates = new TemplateService(s);
  s.notifications = new NotificationService(s);
  s.mentions = new MentionService(s);
  s.activity = new ActivityService(s);
  s.webhooks = new WebhookService(s);
  s.connectors = new ConnectorService(s);
  s.plugins = new PluginManager(s);
  s.backups = new BackupService(s);
  s.alerts = new AlertService(s);
  s.updates = new UpdateService(s);
  s.admin = new AdminService(s);
  s.transfer = new TransferService(s);
  s.exporter = new ExportService(s);
  s.imports = new ImportJobService(s);
  s.realtime = new RealtimeHub(s);
  s.collab = new CollabService(s);

  ensureBaseData(s);
}

/** Startet Hintergrunddienste (Listener, Plugins, Zeitpläne). */
export async function startServices(s: Services, options: { schedulers?: boolean } = {}): Promise<void> {
  // Zwischendateien abgebrochener Importe (Absturz, Neustart mitten im Upload)
  clearUploadTemp(s.config.dataDir);
  const refreshed = s.search.refreshDerivedText();
  if (refreshed) s.log.info(`Suchtexte von ${refreshed} Seiten nach dem Update neu berechnet`);
  const refs = s.analytics.refreshDerived();
  if (refs) s.log.info(`Verweise von ${refs} Seiten für die Inhaltsanalyse erfasst`);
  s.notifications.start();
  s.webhooks.start();
  s.realtime.start();
  s.collab.start();
  s.reviewCycle.listen();
  s.attachmentText.listen();
  await s.plugins.init();
  if (options.schedulers !== false) {
    s.backups.schedule();
    s.alerts.schedule();
    s.admin.scheduleMaintenance();
    s.mail.start();
    s.reviewCycle.schedule();
    s.tasks.schedule();
    s.reads.schedule();
    s.approvals.schedule();
    s.attachmentText.schedule();
  }
}

export async function stopServices(s: Services): Promise<void> {
  s.realtime.stop();
  s.collab.stop();
  s.backups.stop();
  s.alerts.stop();
  s.mail.stop();
  s.reviewCycle.stop();
  s.tasks.stop();
  s.reads.stop();
  s.approvals.stop();
  s.attachmentText.stop();
  s.exporter.stop();
  s.pages.flushViews();
  s.db.close();
  s.instanceLock?.release();
}
