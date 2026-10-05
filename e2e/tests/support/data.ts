import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Nur für die Testinstanz – eigene Datenbank unter e2e/.data, wird bei jedem Lauf neu angelegt. */
export const ADMIN = { username: 'admin', displayName: 'Ada Admin', email: 'admin@example.com', password: 'E2E-Admin-geheim-1' };
export const EDITOR = { username: 'erika', displayName: 'Erika Editor', email: 'erika@example.com', password: 'E2E-Erika-geheim-1' };
export const VIEWER = { username: 'vera', displayName: 'Vera Viewer', email: 'vera@example.com', password: 'E2E-Vera-geheim-1' };

export const SPACE = 'E2E';

const E2E_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const AUTH_DIR = path.join(E2E_DIR, '.auth');

export const AUTH = {
  admin: path.join(AUTH_DIR, 'admin.json'),
  editor: path.join(AUTH_DIR, 'editor.json'),
  viewer: path.join(AUTH_DIR, 'viewer.json'),
};

export interface Seed {
  adminId: number;
  editorId: number;
  viewerId: number;
  spaceKey: string;
  homePageId: number;
  richPageId: number;
  markdownPageId: number;
  codePageId: number;
  childPageId: number;
  boardId: number;
  taskId: number;
  commentId: number;
  attachmentId: number;
  imageAttachmentId: number;
  reviewPageId: number;
}

const SEED_FILE = path.join(AUTH_DIR, 'seed.json');

export function writeSeed(seed: Seed): void {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  fs.writeFileSync(SEED_FILE, JSON.stringify(seed, null, 2));
}

export function readSeed(): Seed {
  return JSON.parse(fs.readFileSync(SEED_FILE, 'utf8')) as Seed;
}

/** Eindeutiger Name für Daten, die ein Test selbst anlegt (Tests laufen parallel). */
export function unique(prefix: string): string {
  // ohne „x“: Die Typografie im Editor macht aus „13x23“ sonst „13×23“
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.replace(/x/g, 'k');
  return `${prefix} ${id}`;
}

/** Beispielinhalt mit den wichtigsten Makros und Formatierungen. */
export const RICH_HTML = [
  '<h2>Überblick</h2>',
  '<p>Diese Seite enthält <strong>fetten</strong> und <em>kursiven</em> Text, einen <a href="https://example.com">Link</a> und den Status <span data-type="status" data-color="green">FERTIG</span>.</p>',
  '<div data-type="callout" data-variant="info"><p>Hinweis: Das ist ein Infokasten.</p></div>',
  '<div data-type="toc" data-max-level="3"></div>',
  '<h2>Technik</h2>',
  '<pre><code class="language-javascript">const antwort = 42;\nconsole.log(antwort);</code></pre>',
  '<table><tbody><tr><th><p>Spalte A</p></th><th><p>Spalte B</p></th></tr><tr><td><p>eins</p></td><td><p>zwei</p></td></tr></tbody></table>',
  '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Erledigt</p></li><li data-type="taskItem" data-checked="false"><p>Offen</p></li></ul>',
  '<div data-type="mermaid" data-code="flowchart LR&#10;  A[Start] --&gt; B[Ziel]"></div>',
  '<h2>Unterseiten und Anhänge</h2>',
  '<div data-type="children" data-depth="1"></div>',
  '<div data-type="attachments"></div>',
].join('');

/** 1×1-PNG für Bild-Uploads. */
export const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
