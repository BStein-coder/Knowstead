import { request } from '@playwright/test';
import { test, expect, ready, expectAccessible } from './support/fixtures';
import { AUTH, unique } from './support/data';

const api = (baseURL: string | undefined, state: string) => request.newContext({ baseURL, storageState: state, extraHTTPHeaders: { 'x-knowstead-client': 'e2e' } });

test.describe('Lesebestätigungen', () => {
  test.use({ storageState: AUTH.editor });

  test('Redaktion fordert an, Erika bestätigt „gelesen und verstanden“', async ({ page, seed, baseURL }) => {
    const admin = await api(baseURL, AUTH.admin);
    const title = unique('Datenschutzrichtlinie');
    const created = await (await admin.post('/api/v1/pages', { data: { spaceKey: seed.spaceKey, title, content: '<p>Personenbezogene Daten sind vertraulich.</p>' } })).json();
    const requested = await admin.put(`/api/v1/pages/${created.id}/read-requirement`, {
      data: { audience: [{ type: 'user', id: seed.editorId }], dueDays: 14, statement: 'Ich habe die Datenschutzrichtlinie gelesen und verstanden.' },
    });
    expect(requested.ok(), await requested.text()).toBeTruthy();

    await page.goto('/read-confirmations');
    await ready(page);
    await expectAccessible(page);
    await page.getByRole('link', { name: title }).click();
    await ready(page);
    await expect(page.getByText(/Bitte lesen und bis .* bestätigen/)).toBeVisible();
    await page.getByRole('button', { name: 'Gelesen und verstanden' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Ich habe die Datenschutzrichtlinie gelesen und verstanden.');
    await dialog.getByRole('button', { name: 'Gelesen und verstanden' }).click();
    await expect(page.getByText(/Gelesen und bestätigt am/)).toBeVisible();

    const evidence = await (await admin.get(`/api/v1/pages/${created.id}/read-confirmations`)).json();
    const row = evidence.rows.find((r: { user: { id: number } | null }) => r.user?.id === seed.editorId);
    expect(row.status).toBe('confirmed');
    await admin.dispose();
  });
});

test.describe('Inhaltsanalyse, Freigabeablauf und Vertretung', () => {
  test.use({ storageState: AUTH.admin });

  test('Inhaltsanalyse zeigt die Arbeitslisten', async ({ page }) => {
    await page.goto('/analytics');
    await ready(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Inhaltsanalyse' })).toBeVisible();
    for (const tab of ['Meistgelesen', 'Ungelesen', 'Suchen ohne Treffer', 'Verwaist', 'Defekte Verweise']) {
      await page.getByRole('button', { name: new RegExp(`^${tab}`) }).click();
      await expect(page.locator('main')).not.toContainText('Fehler');
    }
    await expectAccessible(page);
  });

  test('Freigabeablauf mit zwei Stufen einrichten', async ({ page, seed }) => {
    await page.goto(`/s/${seed.spaceKey}/settings/approvals`);
    await ready(page);
    await expect(page.getByText('Mehrstufiger Freigabeablauf')).toBeVisible();
    await expectAccessible(page);
    const saved = await (
      await page.request.put(`/api/v1/spaces/${seed.spaceKey}/approval-workflow`, {
        headers: { 'x-knowstead-client': 'e2e' },
        data: {
          enabled: true,
          distinctApprovers: true,
          stages: [
            { name: 'Fachbereich', approvers: [{ type: 'user', id: seed.editorId }], minApprovals: 1, escalateDays: 0 },
            { name: 'Qualitätsmanagement', approvers: [{ type: 'user', id: seed.adminId }], minApprovals: 1, escalateDays: 3 },
          ],
        },
      })
    ).json();
    expect(saved.enabled ?? saved.workflow?.enabled).toBeTruthy();
    await page.reload();
    await ready(page);
    await expect(page.getByRole('textbox', { name: 'Name der Stufe' }).first()).toHaveValue('Fachbereich');
    // Aufräumen: andere Tests erwarten Einzelfreigaben
    await page.request.put(`/api/v1/spaces/${seed.spaceKey}/approval-workflow`, { headers: { 'x-knowstead-client': 'e2e' }, data: { enabled: false, stages: saved.stages ?? saved.workflow?.stages ?? [] } });
  });

  test('Vertretung im Profil eintragen', async ({ page }) => {
    await page.goto('/profile/deputies');
    await ready(page);
    await expect(page.getByRole('heading', { name: 'Abwesenheit mit Vertretung' })).toBeVisible();
    await expectAccessible(page);
  });
});

test.describe('Abhängigkeiten im Aufgabenplaner', () => {
  test.use({ storageState: AUTH.editor });

  test('Wartende Aufgabe wird gekennzeichnet und auf der Zeitachse verbunden', async ({ page, seed }) => {
    const first = unique('Konzept');
    const second = unique('Umsetzung');
    const a = await (
      await page.request.post(`/api/v1/boards/${seed.boardId}/tasks`, { headers: { 'x-knowstead-client': 'e2e' }, data: { title: first, startDate: '2026-10-01', dueDate: '2026-10-05' } })
    ).json();
    const b = await page.request.post(`/api/v1/boards/${seed.boardId}/tasks`, {
      headers: { 'x-knowstead-client': 'e2e' },
      data: { title: second, startDate: '2026-10-02', dueDate: '2026-10-08', predecessors: [{ taskId: a.id, type: 'FS', lagDays: 0 }] },
    });
    expect(b.ok(), await b.text()).toBeTruthy();
    const moved = await b.json();
    expect(moved.startDate, 'automatisch nach dem Ende der Vorgängerin').toBe('2026-10-06');

    await page.goto(`/s/${seed.spaceKey}/tasks?board=${seed.boardId}`);
    await ready(page);
    const card = page.locator('.task-card').filter({ hasText: second });
    await expect(card.getByText('Wartet')).toBeVisible();
    await card.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(first)).toBeVisible();
    await expectAccessible(page, '[role="dialog"]');
    // Auswählen genügt: Ohne zusätzlichen Knopfdruck muss die Vorgängerin in der Liste stehen und gespeichert werden
    const third = unique('Abnahme');
    const c = await (
      await page.request.post(`/api/v1/boards/${seed.boardId}/tasks`, { headers: { 'x-knowstead-client': 'e2e' }, data: { title: third, startDate: '2026-10-20', dueDate: '2026-10-22' } })
    ).json();
    await dialog.getByRole('button', { name: 'Abbrechen' }).click();
    await page.reload();
    await ready(page);
    const thirdCard = page.locator('.task-card').filter({ hasText: third });
    await thirdCard.click();
    const thirdDialog = page.getByRole('dialog', { name: 'Aufgabe' });
    await thirdDialog.getByRole('combobox', { name: 'Vorgängerin hinzufügen' }).selectOption({ label: second });
    await expect(thirdDialog.locator('.task-deps-list li')).toHaveCount(1);
    await thirdDialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(thirdDialog).toBeHidden();
    const saved = await (await page.request.get(`/api/v1/tasks?board=${seed.boardId}`, { headers: { 'x-knowstead-client': 'e2e' } })).json();
    expect(saved.items.find((x: { id: number }) => x.id === c.id).predecessors, 'Auswahl allein speichert die Abhängigkeit').toHaveLength(1);

    await thirdCard.click();
    await expect(page.getByRole('dialog', { name: 'Aufgabe' }).locator('.task-deps-list li')).toHaveCount(1);

    // Negativer Versatz per Tastatur: Das Zahlenfeld darf das Minus nicht verschlucken
    const lag = page.getByRole('dialog', { name: 'Aufgabe' }).getByLabel('Versatz in Tagen');
    await lag.click();
    await lag.press('Control+a');
    await lag.pressSequentially('-2');
    await expect(lag).toHaveValue('-2');
    await page.getByRole('dialog', { name: 'Aufgabe' }).getByRole('button', { name: 'Abbrechen' }).click();

    await page.getByRole('button', { name: 'Zeitachse' }).click();
    await expect(page.locator('[data-bar-id]').first()).toBeVisible();
    // Pfeile schon beim ersten Anzeigen – nicht erst nach dem Ziehen oder Zoomen
    await expect(page.locator('path.timeline-dep').first()).toBeAttached();
  });
});
