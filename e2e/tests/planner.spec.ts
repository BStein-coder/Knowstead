import type { Page } from '@playwright/test';
import { test, expect, ready, expectAccessible } from './support/fixtures';
import { AUTH, unique, type Seed } from './support/data';

/**
 * Aufgabenplaner in Bewegung und im Überblick: Haken und Gleiten der Karten, Ziehen mit Einfügemarke, „Meine Aufgaben“,
 * Kalender (Seite und Ansicht im Plan) und die Übersicht „Projekte“.
 */
const HEADERS = { 'x-knowstead-client': 'e2e' };
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const offsetDay = (days: number) => ymd(new Date(Date.now() + days * 86400000));

interface Created {
  id: number;
  name: string;
  tasks: Record<string, number>;
}

/** Legt einen Plan mit Aufgaben an (über die Schnittstelle – schneller und unabhängig von der Oberfläche). */
async function createPlan(page: Page, seed: Seed, tasks: { title: string; body?: Record<string, unknown> }[], description = ''): Promise<Created> {
  const name = unique('Plan');
  const board = await (await page.request.post(`/api/v1/spaces/${seed.spaceKey}/boards`, { headers: HEADERS, data: { name, description } })).json();
  const ids: Record<string, number> = {};
  for (const task of tasks) {
    const res = await page.request.post(`/api/v1/boards/${board.id}/tasks`, { headers: HEADERS, data: { title: task.title, ...task.body } });
    expect(res.ok(), await res.text()).toBeTruthy();
    ids[task.title] = (await res.json()).id;
  }
  return { id: board.id, name, tasks: ids };
}

/** Merkt sich, welche Karten gleiten (lib/flip.ts ruft `animate` mit transform) – deterministisch statt Messung im Flug. */
async function recordGlides(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const glides: string[] = [];
    (window as unknown as { __glides: string[] }).__glides = glides;
    const original = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, ...args: Parameters<Element['animate']>) {
      const key = (this as HTMLElement).dataset?.flip;
      if (key) glides.push(key);
      return original.apply(this, args);
    };
  });
}
const glides = (page: Page) => page.evaluate(() => (window as unknown as { __glides: string[] }).__glides);

test.describe('Plan: Haken und Karten in Bewegung', () => {
  test.use({ storageState: AUTH.editor });

  test('Haken auf der Karte schließt ab: die Karte gleitet in die letzte Spalte, Kennzahlen und Zähler folgen', async ({ page, seed }) => {
    await recordGlides(page);
    const plan = await createPlan(page, seed, [{ title: 'Erste' }, { title: 'Zweite' }]);
    await page.goto(`/s/${seed.spaceKey}/tasks?board=${plan.id}`);
    await ready(page);

    const tiles = page.locator('.plan-stat');
    await expect(tiles).toHaveCount(4);
    await expect(tiles.filter({ hasText: 'Offen' }).locator('.plan-stat-value')).toHaveText('2');
    const columns = page.locator('.board-column');
    await expect(columns.first().locator('.task-card')).toHaveCount(2);

    await page.getByRole('button', { name: 'Erledigt: Erste' }).click();
    // Sofort (Vorschau, noch vor der Antwort des Servers): die Karte steht in der letzten Spalte, der Haken ist gesetzt
    const done = columns.last().locator('.task-card', { hasText: 'Erste' });
    await expect(done).toBeVisible();
    await expect(done).toHaveClass(/done/);
    await expect(done.getByRole('button', { name: 'Wieder öffnen: Erste' })).toBeVisible();
    await expect(columns.first().locator('.task-card')).toHaveCount(1);
    await expect(tiles.filter({ hasText: 'Offen' }).locator('.plan-stat-value')).toHaveText('1');
    expect(await glides(page), 'die erledigte Karte gleitet, die Karte darunter rückt nach').toContain(`task-${plan.tasks.Erste}`);

    // Der Server hat es übernommen
    await page.reload();
    await ready(page);
    await expect(columns.last().locator('.task-card', { hasText: 'Erste' })).toHaveClass(/done/);

    // Wieder öffnen: zurück in die erste Spalte
    await page.getByRole('button', { name: 'Wieder öffnen: Erste' }).click();
    await expect(columns.first().locator('.task-card', { hasText: 'Erste' })).toBeVisible();
    await expect(columns.first().locator('.task-card', { hasText: 'Erste' })).not.toHaveClass(/done/);
  });

  test('Bei reduzierter Bewegung springen die Karten, nichts gleitet', async ({ browser, seed }) => {
    const context = await browser.newContext({ storageState: AUTH.editor, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await recordGlides(page);
    const plan = await createPlan(page, seed, [{ title: 'Springt' }, { title: 'Bleibt' }]);
    await page.goto(`/s/${seed.spaceKey}/tasks?board=${plan.id}`);
    await ready(page);
    await page.getByRole('button', { name: 'Erledigt: Springt' }).click();
    await expect(page.locator('.board-column').last().locator('.task-card', { hasText: 'Springt' })).toBeVisible();
    expect(await glides(page)).toEqual([]);
    await context.close();
  });

  test('Ziehen: Die Karte wird abgedunkelt, eine Einfügemarke zeigt die Stelle, das Ablegen bleibt erhalten', async ({ page, seed }) => {
    const plan = await createPlan(page, seed, [{ title: 'Zieh mich' }, { title: 'Anker', body: { bucket: 'doing' } }]);
    await page.goto(`/s/${seed.spaceKey}/tasks?board=${plan.id}`);
    await ready(page);
    const dragged = page.locator('.task-card', { hasText: 'Zieh mich' });
    const anchor = page.locator('.board-column').nth(1).locator('.task-card', { hasText: 'Anker' });
    const from = (await dragged.boundingBox())!;
    const to = (await anchor.boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + 30);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 20, from.y + 40, { steps: 3 });
    await page.mouse.move(to.x + to.width / 2, to.y + 8, { steps: 8 });
    await expect(page.locator('.task-card.is-dragging')).toHaveCount(1);
    await expect(page.locator('.drop-line')).toHaveCount(1);
    await page.mouse.up();
    await expect(page.locator('.drop-line')).toHaveCount(0);
    const target = page.locator('.board-column').nth(1);
    await expect(target.locator('.task-card')).toHaveCount(2);
    await expect(target.locator('.task-card-title-text').first()).toContainText('Zieh mich');

    await page.reload();
    await ready(page);
    await expect(page.locator('.board-column').nth(1).locator('.task-card-title-text').first()).toContainText('Zieh mich');
  });

  test('Kalender als Ansicht des Plans: Fälligkeiten stehen am Tag, ein Klick öffnet die Aufgabe', async ({ page, seed }) => {
    const plan = await createPlan(page, seed, [{ title: 'Heute dran', body: { dueDate: offsetDay(0) } }, { title: 'Ohne Datum' }]);
    await page.goto(`/s/${seed.spaceKey}/tasks?board=${plan.id}`);
    await ready(page);
    await page.getByRole('button', { name: 'Kalender', exact: true }).click();
    const calendar = page.locator('.cal');
    await expect(calendar).toBeVisible();
    const chip = calendar.locator('.cal-cell.today .cal-chip', { hasText: 'Heute dran' });
    await expect(chip).toBeVisible();
    await expect(calendar.getByText('1 ohne Fälligkeit – nicht im Kalender')).toBeVisible();
    await expectAccessible(page, '.cal');
    await chip.click();
    await expect(page.getByRole('dialog', { name: 'Aufgabe' })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Abbrechen' }).click();
    // Die Wahl der Ansicht bleibt erhalten
    await page.reload();
    await ready(page);
    await expect(page.locator('.cal')).toBeVisible();
    await page.getByRole('button', { name: 'Board', exact: true }).click();
  });
});

test.describe('Meine Aufgaben und Kalender', () => {
  test.use({ storageState: AUTH.editor });

  test('Meine Aufgaben: Abhaken streicht durch, die Zeile gleitet hinaus, die übrigen rücken nach', async ({ page, seed }) => {
    const plan = await createPlan(page, seed, [
      { title: 'Zuerst abhaken', body: { assigneeId: seed.editorId, dueDate: offsetDay(2) } },
      { title: 'Danach dran', body: { assigneeId: seed.editorId, dueDate: offsetDay(3) } },
    ]);
    await page.goto('/tasks');
    await ready(page);
    const first = page.locator('.my-task', { hasText: 'Zuerst abhaken' });
    const second = page.locator('.my-task', { hasText: 'Danach dran' });
    await expect(second).toBeVisible();
    const before = (await second.boundingBox())!;
    await first.getByRole('button', { name: 'Erledigt: Zuerst abhaken' }).click();
    // Erst zeigt die Zeile den neuen Zustand (Haken, Durchstreichen) und gleitet hinaus …
    await expect(first).toHaveClass(/is-completing/);
    await expect(first).toHaveClass(/done/);
    // … dann ist sie weg, und die nächste ist nachgerückt
    await expect(first).toHaveCount(0);
    await expect.poll(async () => (await second.boundingBox())!.y).toBeLessThan(before.y);
    const state = await (await page.request.get(`/api/v1/tasks?board=${plan.id}&status=done`, { headers: HEADERS })).json();
    expect(state.items.map((x: { title: string }) => x.title)).toEqual(['Zuerst abhaken']);
  });

  test('Kalender: Monat und Woche, Blättern, Liste des Tages, Abhaken, „Meine“ und „Alle“', async ({ page, seed }) => {
    const plan = await createPlan(page, seed, [
      { title: 'Heute fällig', body: { assigneeId: seed.editorId, dueDate: offsetDay(0), priority: 'high' } },
      { title: 'Gestern fällig', body: { assigneeId: seed.editorId, dueDate: offsetDay(-1) } },
      { title: 'Fremde Aufgabe', body: { assigneeId: seed.adminId, dueDate: offsetDay(0) } },
    ]);
    await page.goto('/calendar');
    await ready(page);
    await expect(page.getByRole('heading', { name: 'Kalender', level: 1 })).toBeVisible();
    const title = page.locator('.cal-title');
    const monthName = (date: Date) => date.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
    await expect(title).toHaveText(monthName(new Date()));

    // Heute: Liste mit allem, was heute fällig ist, und was überfällig ist
    const panel = page.locator('.cal-panel');
    await expect(panel.getByRole('heading', { name: 'Heute', level: 3 })).toBeVisible();
    await expect(panel.locator('.cal-item', { hasText: 'Heute fällig' })).toBeVisible();
    await expect(panel.locator('.cal-item', { hasText: 'Gestern fällig' })).toBeVisible();
    await expect(panel.getByText('Fremde Aufgabe')).toHaveCount(0);
    await expect(page.locator('.cal-cell.today .cal-chip', { hasText: 'Heute fällig' })).toBeVisible();

    // „Alle“ zeigt auch fremde Aufgaben
    await page.getByRole('button', { name: 'Alle', exact: true }).click();
    await expect(panel.locator('.cal-item', { hasText: 'Fremde Aufgabe' })).toBeVisible();
    await page.getByRole('button', { name: 'Meine', exact: true }).click();
    await expect(panel.getByText('Fremde Aufgabe')).toHaveCount(0);

    // Abhaken in der Liste: die Aufgabe bleibt stehen, durchgestrichen
    await panel.getByRole('button', { name: 'Erledigt: Heute fällig' }).click();
    await expect(panel.locator('.cal-item.done', { hasText: 'Heute fällig' })).toBeVisible();
    const done = await (await page.request.get(`/api/v1/tasks?board=${plan.id}&status=done`, { headers: HEADERS })).json();
    expect(done.items.map((x: { title: string }) => x.title)).toEqual(['Heute fällig']);

    // Woche: sieben Spalten, eine Zeile; Blättern wechselt den Zeitraum, „Heute“ kehrt zurück
    await page.getByRole('button', { name: 'Woche', exact: true }).click();
    await expect(page.locator('.cal-grid.week')).toBeVisible();
    await expect(page.locator('.cal-grid.week tbody tr')).toHaveCount(1);
    const label = await title.textContent();
    await page.getByRole('button', { name: 'Weiter' }).click();
    await expect(title).not.toHaveText(label ?? '');
    await page.getByRole('button', { name: 'Heute', exact: true }).first().click();
    await expect(title).toHaveText(label ?? '');
    await page.getByRole('button', { name: 'Monat', exact: true }).click();
    await page.getByRole('button', { name: 'Zurück' }).click();
    await expect(title).toHaveText(monthName(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1)));
    await expectAccessible(page, '.cal');
  });
});

test.describe('Projekte', () => {
  test.use({ storageState: AUTH.editor });

  test('Karten zeigen Fortschritt, nächsten Termin und Beteiligte; Filter, Suche und Öffnen', async ({ page, seed }) => {
    const running = await createPlan(
      page,
      seed,
      [
        { title: 'Schon fertig', body: { status: 'done', assigneeId: seed.editorId } },
        { title: 'Nächster Meilenstein', body: { assigneeId: seed.editorId, dueDate: offsetDay(5), priority: 'high' } },
      ],
      'Läuft gerade',
    );
    const finished = await createPlan(page, seed, [{ title: 'Alles erledigt', body: { status: 'done' } }]);
    const planning = await createPlan(page, seed, []);

    await page.goto('/projects');
    await ready(page);
    await expect(page.getByRole('heading', { name: 'Projekte', level: 1 })).toBeVisible();
    await expect(page.locator('.plan-stat')).toHaveCount(4);

    const card = (name: string) => page.locator('.project-card', { hasText: name });
    await expect(card(running.name)).toBeVisible();
    await expect(card(running.name).locator('.project-status')).toContainText('In Arbeit');
    await expect(card(running.name).getByText('Nächster Meilenstein')).toBeVisible();
    await expect(card(running.name).getByText('1/2 Aufgaben')).toBeVisible();
    await expect(card(running.name).getByRole('img', { name: '50 %' })).toBeVisible();
    await expect(card(running.name).getByText('Läuft gerade')).toBeVisible();
    await expect(card(running.name).locator('.avatar').first()).toBeVisible();
    await expect(card(finished.name).locator('.project-status')).toContainText('Abgeschlossen');
    await expect(card(planning.name).locator('.project-status')).toContainText('In Planung');
    await expect(card(planning.name).getByText('Noch keine Aufgaben')).toBeVisible();

    // Filter und Suche
    await page.getByRole('button', { name: /^Abgeschlossen/ }).click();
    await expect(card(finished.name)).toBeVisible();
    await expect(card(running.name)).toHaveCount(0);
    await page.getByRole('button', { name: /^Alle/ }).click();
    await page.getByLabel('Projekte durchsuchen').fill(planning.name);
    await expect(page.locator('.project-card')).toHaveCount(1);
    await page.getByLabel('Projekte durchsuchen').fill('gibt es nicht ' + unique('x'));
    await expect(page.getByText('Keine passenden Projekte.')).toBeVisible();
    await page.getByLabel('Projekte durchsuchen').fill('');
    await expectAccessible(page, '.projects-page');

    // Öffnen führt in den Plan
    await card(running.name).click();
    await expect(page).toHaveURL(new RegExp(`/s/${seed.spaceKey}/tasks\\?board=${running.id}`));
    await expect(page.locator('.task-card', { hasText: 'Nächster Meilenstein' })).toBeVisible();
  });

  test('„Neuer Plan“ führt über die Wahl des Bereichs in den Dialog', async ({ page, seed }) => {
    await page.goto('/projects');
    await ready(page);
    await page.getByRole('button', { name: 'Neuer Plan' }).click();
    const chooser = page.getByRole('dialog', { name: 'Neuer Plan' });
    await expect(chooser.getByText('In welchem Bereich soll der Plan entstehen?')).toBeVisible();
    await chooser.getByRole('button', { name: /E2E-Testbereich/ }).click();
    await expect(page).toHaveURL(new RegExp(`/s/${seed.spaceKey}/tasks`));
    const dialog = page.getByRole('dialog', { name: 'Neuer Plan' });
    await expect(dialog).toBeVisible();
    const name = unique('Neues Projekt');
    await dialog.getByLabel('Name').fill(name);
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.board-summary strong')).toHaveText(name);
    // Der Hinweis in der Adresse ist weg: Neuladen öffnet den Dialog nicht noch einmal
    await page.reload();
    await ready(page);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
