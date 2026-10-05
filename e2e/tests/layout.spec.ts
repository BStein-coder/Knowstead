import { test, expect, ready, settled } from './support/fixtures';
import { AUTH } from './support/data';

/**
 * Überlappungen und Abschneidungen, die bei einer Messung über alle Seiten aufgefallen waren:
 * Diese Tests halten die behobenen Fälle fest – pro Fensterbreite, in der sie auftraten.
 */
const box = async (locator: import('@playwright/test').Locator) => {
  const b = await locator.boundingBox();
  expect(b, 'Element ist sichtbar').not.toBeNull();
  return b!;
};
const overlap = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1;

test.describe('Aufgabenplaner – Seitenränder', () => {
  test.use({ storageState: AUTH.admin, viewport: { width: 1280, height: 800 } });

  test('„Neuer Plan“ klebt weder an der Kopfzeile noch am rechten Rand', async ({ page, seed }) => {
    await page.goto(`/s/${seed.spaceKey}/tasks?board=${seed.boardId}`);
    await ready(page);
    const padding = await page.locator('.board-page').evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
    expect(padding, 'Plan hat einen Seitenrand').toBeGreaterThanOrEqual(16);
    const topbar = await box(page.locator('.topbar'));
    const button = await box(page.getByRole('button', { name: 'Neuer Plan' }));
    expect(button.y, 'Abstand zur Kopfzeile').toBeGreaterThanOrEqual(topbar.y + topbar.height + 12);
    expect(button.x + button.width, 'nicht am rechten Rand angeschnitten').toBeLessThanOrEqual(1280 - 16);
  });
});

test.describe('Handy – Kopfzeile und Seitenleiste', () => {
  test.use({ storageState: AUTH.admin, viewport: { width: 400, height: 800 } });

  test('Brotkrumen und „Bearbeiten“ überlappen nicht; Tastenkürzel liegt nicht auf der Lupe', async ({ page, seed }) => {
    await page.goto(`/s/${seed.spaceKey}/p/${seed.childPageId}`);
    await ready(page);
    const crumbs = await box(page.locator('.breadcrumbs a').first());
    const edit = await box(page.getByRole('button', { name: 'Bearbeiten' }));
    expect(overlap(crumbs, edit), 'Bereichsname liegt nicht unter dem Knopf').toBe(false);
    expect(crumbs.x + crumbs.width, 'Brotkrumen enden vor dem Knopf').toBeLessThanOrEqual(edit.x + 1);
    await expect(page.locator('.topbar-search kbd')).toBeHidden();
  });
});

test.describe('Zeitstrahl – feststehende Namensspalte', () => {
  test.use({ storageState: AUTH.admin, viewport: { width: 1100, height: 800 } });

  test('Balken schieben sich beim Scrollen hinter die Namen, nicht darüber', async ({ page, request, seed }) => {
    // Eigener Plan mit zwei datierten Aufgaben, damit der Zeitstrahl seitlich scrollen muss.
    // Ändernde Anfragen brauchen die Kopfzeile X-Knowstead-Client (CSRF-Schutz).
    const post = async <T>(url: string, data: unknown): Promise<T> => {
      const res = await request.post(url, { data, headers: { 'X-Knowstead-Client': 'e2e' } });
      expect(res.ok(), `${url}: ${res.status()} ${await res.text()}`).toBe(true);
      return (await res.json()) as T;
    };
    const board = await post<{ id: number }>(`/api/v1/spaces/${seed.spaceKey}/boards`, { name: `Zeitstrahl ${Date.now().toString(36)}` });
    const first = await post<{ id: number }>(`/api/v1/boards/${board.id}/tasks`, { title: 'Erster Ablauf', startDate: '2030-03-04', dueDate: '2030-03-08' });
    await post(`/api/v1/boards/${board.id}/tasks`, { title: 'Zweiter Ablauf', startDate: '2030-03-11', dueDate: '2030-03-20', predecessors: [{ taskId: first.id }] });

    await page.addInitScript(() => localStorage.setItem('knowstead.tasks.view', 'timeline'));
    await page.goto(`/s/${seed.spaceKey}/tasks?board=${board.id}`);
    await ready(page);
    const timeline = page.locator('.timeline');
    await timeline.locator('.timeline-bar').first().waitFor();
    await timeline.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    await page.waitForTimeout(300);

    const verdeckt = await page.evaluate(() => {
      const treffer: string[] = [];
      for (const bar of document.querySelectorAll<HTMLElement>('.timeline-bar')) {
        const bb = bar.getBoundingClientRect();
        for (const label of document.querySelectorAll<HTMLElement>('.timeline-label')) {
          const lb = label.getBoundingClientRect();
          const breite = Math.min(bb.right, lb.right) - Math.max(bb.left, lb.left);
          const hoehe = Math.min(bb.bottom, lb.bottom) - Math.max(bb.top, lb.top);
          if (breite <= 1 || hoehe <= 1) continue;
          const oben = document.elementFromPoint(Math.max(bb.left, lb.left) + 8, Math.max(bb.top, lb.top) + hoehe / 2);
          if (oben?.closest('.timeline-bar')) treffer.push(`${bar.title.split(' · ')[0]} liegt über „${label.textContent?.trim()}“`);
        }
      }
      return treffer;
    });
    expect(verdeckt, 'kein Balken verdeckt einen Aufgabennamen').toEqual([]);
    await expect(page.getByRole('button', { name: /Erster Ablauf/ })).toBeVisible();
  });
});

test.describe('Reiter brechen um', () => {
  test.use({ storageState: AUTH.admin, viewport: { width: 1024, height: 800 } });

  test('Bereichseinstellungen: kein Reiter ragt über den rechten Rand', async ({ page, seed }) => {
    await page.goto(`/s/${seed.spaceKey}/settings`);
    await ready(page);
    const tabs = page.locator('main .tabs a.tab');
    expect(await tabs.count()).toBeGreaterThan(5);
    for (const tab of await tabs.all()) {
      const b = await box(tab);
      expect(b.x + b.width, `Reiter „${await tab.innerText()}“ ist ganz zu sehen`).toBeLessThanOrEqual(1024);
    }
  });
});

test.describe('Aufgabendialog – Chat als Seitenspalte (breit)', () => {
  test.use({ storageState: AUTH.admin, viewport: { width: 1280, height: 800 } });

  test('Chat steht rechts neben den Feldern; Eingabefeld auch nach dem Scrollen erreichbar', async ({ page, seed }) => {
    await page.goto(`/s/${seed.spaceKey}/tasks?board=${seed.boardId}&task=${seed.taskId}`);
    await ready(page);
    const dialog = page.getByRole('dialog', { name: 'Aufgabe' });
    const senden = dialog.getByRole('button', { name: 'Senden' });
    await senden.waitFor();
    // Der Dialog gleitet beim Öffnen ein. Jede Messung ist ein eigener Aufruf an den Browser: Fällt die erste vor und
    // die zweite nach den Start der Bewegung, liegt dazwischen ihr Anfangsversatz (rund 15 Pixel) – auf einem
    // langsamen Rechner jedes Mal, auf einem schnellen fast nie. Deshalb erst messen, wenn der Dialog steht.
    await settled(page);
    const form = await box(dialog.locator('form.task-form'));
    const chat = await box(dialog.getByRole('region', { name: 'Chat' }));
    expect(chat.x, 'Chat beginnt rechts vom Formular').toBeGreaterThanOrEqual(form.x + form.width - 1);
    expect(Math.abs(chat.y - form.y), 'Chat oben bündig mit dem Formular').toBeLessThan(8);
    expect(overlap(form, chat), 'Formular und Chat überlappen nicht').toBe(false);
    const body = await box(dialog.locator('.modal-body'));
    const knopf = await box(senden);
    expect(knopf.y + knopf.height, '„Senden“ ohne Scrollen sichtbar').toBeLessThanOrEqual(body.y + body.height + 0.5);
    // Formular bis ans Ende scrollen – die Chatspalte bleibt stehen
    await dialog.locator('.modal-body').evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(200);
    const danach = await box(senden);
    expect(danach.y + danach.height, '„Senden“ nach dem Scrollen weiterhin sichtbar').toBeLessThanOrEqual(body.y + body.height + 0.5);
    await expect(dialog.getByText('Kennzeichnungen', { exact: true })).toBeVisible();
  });
});

test.describe('Aufgabendialog – Chat als Seitenspalte (schmal)', () => {
  test.use({ storageState: AUTH.admin, viewport: { width: 900, height: 800 } });

  test('Auf schmalen Bildschirmen steht der Chat unter den Feldern', async ({ page, seed }) => {
    await page.goto(`/s/${seed.spaceKey}/tasks?board=${seed.boardId}&task=${seed.taskId}`);
    await ready(page);
    const dialog = page.getByRole('dialog', { name: 'Aufgabe' });
    await dialog.getByRole('button', { name: 'Senden' }).waitFor();
    await settled(page); // der Dialog gleitet ein – erst messen, wenn er steht
    const form = await box(dialog.locator('form.task-form'));
    const chat = await box(dialog.getByRole('region', { name: 'Chat' }));
    expect(chat.y, 'Chat beginnt unter dem Formular').toBeGreaterThanOrEqual(form.y + form.height - 1);
    expect(Math.abs(chat.x - form.x), 'Chat linksbündig mit dem Formular').toBeLessThan(2);
    expect(overlap(form, chat), 'Formular und Chat überlappen nicht').toBe(false);
  });
});
