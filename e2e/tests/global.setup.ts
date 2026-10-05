import { test as setup, expect, request, type APIRequestContext, type APIResponse } from '@playwright/test';
import { ADMIN, AUTH, EDITOR, PNG_1X1, RICH_HTML, SPACE, VIEWER, writeSeed } from './support/data';

async function json<T>(res: APIResponse): Promise<T> {
  expect(res.ok(), `${res.url()} → ${res.status()}: ${await res.text()}`).toBeTruthy();
  return (await res.json()) as T;
}

async function newApi(baseURL: string): Promise<APIRequestContext> {
  return request.newContext({ baseURL, extraHTTPHeaders: { 'x-knowstead-client': 'e2e' } });
}

/** Rundgang und Einstiegsliste nicht automatisch öffnen – sie würden Klicks in den Tests verdecken. */
async function quietOnboarding(api: APIRequestContext): Promise<void> {
  await json(await api.patch('/api/v1/me/preferences', { data: { onboarding: { tourDone: true } } }));
}

setup('Testinstanz einrichten: Konten, Bereich, Seiten, Aufgaben', async ({ baseURL }) => {
  const admin = await newApi(baseURL!);

  // Ersteinrichtung (Aufruf vom selben Rechner – ohne Einrichtungscode)
  const setupRes = await json<{ user: { id: number } }>(
    await admin.post('/api/v1/setup', {
      data: { siteName: 'Knowstead E2E', username: ADMIN.username, displayName: ADMIN.displayName, email: ADMIN.email, password: ADMIN.password, sampleContent: true },
    }),
  );
  await quietOnboarding(admin);
  await admin.storageState({ path: AUTH.admin });

  // Weitere Konten
  const editorUser = await json<{ id: number }>(await admin.post('/api/v1/admin/users', { data: EDITOR }));
  const viewerUser = await json<{ id: number }>(await admin.post('/api/v1/admin/users', { data: VIEWER }));
  for (const [account, file] of [
    [EDITOR, AUTH.editor],
    [VIEWER, AUTH.viewer],
  ] as const) {
    const api = await newApi(baseURL!);
    await json(await api.post('/api/v1/auth/login', { data: { login: account.username, password: account.password } }));
    await quietOnboarding(api);
    await api.storageState({ path: file });
    await api.dispose();
  }

  // Bereich: alle Angemeldeten lesen, Erika bearbeitet
  const space = await json<{ key: string; homePageId: number }>(
    await admin.post('/api/v1/spaces', { data: { key: SPACE, name: 'E2E-Testbereich', description: 'Daten für die Oberflächentests', icon: '🧪', preset: 'readonly' } }),
  );
  const grants = await json<{ subjectType: string; subjectId: number; role: string }[]>(await admin.get(`/api/v1/spaces/${SPACE}/permissions`));
  await json(await admin.put(`/api/v1/spaces/${SPACE}/permissions`, { data: { grants: [...grants, { subjectType: 'user', subjectId: editorUser.id, role: 'editor' }] } }));

  // Seiten in verschiedenen Formaten, mit zweiter Version, Unterseite, Kommentar und Anhängen
  const rich = await json<{ id: number }>(
    await admin.post('/api/v1/pages', { data: { spaceKey: SPACE, title: 'Makroseite', content: RICH_HTML, labels: ['e2e', 'makros'] } }),
  );
  await json(
    await admin.put(`/api/v1/pages/${rich.id}`, { data: { title: 'Makroseite', content: `${RICH_HTML}<p>Zweite Fassung mit Ergänzung.</p>`, changeNote: 'Zweite Fassung', baseVersion: 1 } }),
  );
  const child = await json<{ id: number }>(
    await admin.post('/api/v1/pages', { data: { spaceKey: SPACE, parentId: rich.id, title: 'Unterseite Alpha', content: '<p>Inhalt der Unterseite.</p>' } }),
  );
  const markdown = await json<{ id: number }>(
    await admin.post('/api/v1/pages', {
      data: { spaceKey: SPACE, title: 'Markdown-Notizen', contentType: 'markdown', content: '# Notizen\n\n- Punkt eins\n- Punkt zwei\n\n```bash\necho hallo\n```\n' },
    }),
  );
  const code = await json<{ id: number }>(
    await admin.post('/api/v1/pages', { data: { spaceKey: SPACE, title: 'Konfiguration', contentType: 'code', language: 'yaml', content: 'dienst:\n  port: 3000\n' } }),
  );
  const reviewPage = await json<{ id: number }>(
    await admin.post('/api/v1/pages', { data: { spaceKey: SPACE, title: 'Richtlinie zur Prüfung', content: '<p>Bitte prüfen.</p>' } }),
  );
  await json(await admin.post(`/api/v1/pages/${reviewPage.id}/reviews`, { data: { reviewerId: editorUser.id, note: 'Bitte fachlich prüfen' } }));

  const comment = await json<{ id: number }>(await admin.post(`/api/v1/pages/${rich.id}/comments`, { data: { body: '<p>Erster Kommentar zur Makroseite.</p>' } }));
  const uploaded = await json<{ id: number }[]>(
    await admin.post(`/api/v1/pages/${rich.id}/attachments`, {
      multipart: { file: { name: 'notiz.txt', mimeType: 'text/plain', buffer: Buffer.from('Textanhang für die Suche: Tannenbaum') } },
    }),
  );
  const image = await json<{ id: number }[]>(
    await admin.post(`/api/v1/pages/${rich.id}/attachments`, { multipart: { file: { name: 'pixel.png', mimeType: 'image/png', buffer: PNG_1X1 } } }),
  );

  // Aufgabenplaner
  const board = await json<{ id: number }>(await admin.post(`/api/v1/spaces/${SPACE}/boards`, { data: { name: 'E2E-Plan', description: 'Plan für die Tests' } }));
  const task = await json<{ id: number }>(
    await admin.post(`/api/v1/boards/${board.id}/tasks`, {
      data: { title: 'Erste Aufgabe', bucket: 'todo', assigneeId: editorUser.id, priority: 'high', dueDate: '2030-01-15', pageId: rich.id, checklist: [{ text: 'Teilschritt' }] },
    }),
  );

  writeSeed({
    adminId: setupRes.user.id,
    editorId: editorUser.id,
    viewerId: viewerUser.id,
    spaceKey: space.key,
    homePageId: space.homePageId,
    richPageId: rich.id,
    markdownPageId: markdown.id,
    codePageId: code.id,
    childPageId: child.id,
    boardId: board.id,
    taskId: task.id,
    commentId: comment.id,
    attachmentId: uploaded[0].id,
    imageAttachmentId: image[0].id,
    reviewPageId: reviewPage.id,
  });
  await admin.dispose();
});
