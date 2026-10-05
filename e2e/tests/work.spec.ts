import fs from 'node:fs';
import { test, expect, ready, expectAccessible } from './support/fixtures';
import { AUTH, unique } from './support/data';

test.describe('Aufgabenplaner', () => {
  test.use({ storageState: AUTH.editor });

  test('Aufgabe anlegen, bearbeiten und erledigen; erscheint unter „Meine Aufgaben“', async ({ page, seed }) => {
    await page.goto(`/s/${seed.spaceKey}/tasks?board=${seed.boardId}`);
    await ready(page);
    await expect(page.getByText('Erste Aufgabe')).toBeVisible();

    const title = unique('Aufgabe');
    const column = page.locator('.board-column').first();
    await column.getByRole('button', { name: 'Aufgabe hinzufügen' }).click();
    await column.getByPlaceholder('Was ist zu tun?').fill(title);
    await column.getByRole('button', { name: 'Anlegen' }).click();
    const card = page.locator('.task-card').filter({ hasText: title });
    await expect(card).toBeVisible();

    // Details: mir zuweisen geht über den Dialog – hier Status auf erledigt setzen
    await card.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Aufgabe' })).toBeVisible();
    await expectAccessible(page, '[role="dialog"]');
    await dialog.getByLabel('Status').selectOption('done');
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.task-card.done').filter({ hasText: title })).toBeVisible();

    // Listenansicht
    await page.getByRole('button', { name: 'Liste' }).click();
    await expect(page.getByRole('table')).toContainText(title);

    // Meine Aufgaben: die im Setup zugewiesene Aufgabe
    await page.goto('/tasks');
    await expect(page.getByText('Erste Aufgabe')).toBeVisible();
  });

  test('Chat an der Aufgabe: schreiben, bearbeiten, löschen – Zähler auf der Karte', async ({ page, seed }) => {
    await page.goto(`/s/${seed.spaceKey}/tasks?board=${seed.boardId}&task=${seed.taskId}`);
    await ready(page);
    const dialog = page.getByRole('dialog', { name: 'Aufgabe' });
    const chat = dialog.getByRole('region', { name: 'Chat' });
    await expect(chat).toContainText('Noch keine Nachrichten');

    const text = unique('Nachricht');
    await chat.getByRole('textbox', { name: /Nachricht schreiben/ }).fill(text);
    await chat.getByRole('button', { name: 'Senden' }).click();
    await expect(chat.locator('.comment-text')).toContainText(text);
    await expect(chat.getByRole('textbox', { name: /Nachricht schreiben/ })).toHaveText('');
    await expectAccessible(page, '[role="dialog"]');

    // Zähler auf der Karte – der Chat verändert die Aufgabe selbst nicht, „Abbrechen“ genügt
    await dialog.getByRole('button', { name: 'Abbrechen' }).click();
    const card = page.locator('.task-card').filter({ hasText: 'Erste Aufgabe' });
    await expect(card.getByTitle('Eine Nachricht im Chat')).toBeVisible();

    // Bearbeiten und löschen der eigenen Nachricht
    await card.click();
    await chat.getByRole('button', { name: 'Bearbeiten' }).click();
    // Beim Bearbeiten stehen zwei Eingabefelder im Chat: das der Nachricht (oben) und das für neue Nachrichten (unten)
    const editor = chat.getByRole('textbox', { name: /Nachricht schreiben/ }).first();
    await editor.fill(`${text} (ergänzt)`);
    await chat.getByRole('button', { name: 'Speichern' }).click();
    await expect(chat.locator('.comment-text')).toContainText('(ergänzt)');
    await expect(chat).toContainText('bearbeitet');
    await chat.getByRole('button', { name: 'Löschen' }).click();
    await page.getByRole('dialog', { name: 'Nachricht löschen?' }).getByRole('button', { name: 'Löschen' }).click();
    await expect(chat).toContainText('Noch keine Nachrichten');
  });

  test('Erwähnung im Chat: Menü liegt über dem Dialog, Escape schließt nur das Menü, Erwähnte wird benachrichtigt', async ({ page, request, browser, baseURL, seed }) => {
    // Eigene Aufgabe – der Chat der Seed-Aufgabe gehört dem Test darüber
    const created = await request.post(`/api/v1/boards/${seed.boardId}/tasks`, { data: { title: unique('Erwähnung') }, headers: { 'X-Knowstead-Client': 'e2e' } });
    expect(created.ok(), await created.text()).toBe(true);
    const task = (await created.json()) as { id: number };

    await page.goto(`/s/${seed.spaceKey}/tasks?board=${seed.boardId}&task=${task.id}`);
    await ready(page);
    const dialog = page.getByRole('dialog', { name: 'Aufgabe' });
    const chat = dialog.getByRole('region', { name: 'Chat' });
    const box = chat.getByRole('textbox', { name: /Nachricht schreiben/ });
    await box.click();
    await page.keyboard.type('@');
    const menu = page.locator('.suggestion-list');
    await expect(menu).toBeVisible();
    await expect(menu.locator('.suggestion-item').first()).toBeVisible();

    // Das Menü liegt ganz im Fenster und oben auf – im Dialog lag es früher unsichtbar dahinter
    const placement = await menu.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const points = [
        [r.left + 6, r.top + 6],
        [r.right - 6, r.top + 6],
        [r.left + 6, r.bottom - 6],
        [r.right - 6, r.bottom - 6],
        [r.left + r.width / 2, r.top + r.height / 2],
      ];
      return {
        inside: r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight,
        onTop: points.every(([x, y]) => el.contains(document.elementFromPoint(x, y))),
      };
    });
    expect(placement, 'Vorschlagsmenü ist ganz sichtbar').toEqual({ inside: true, onTop: true });

    // Filtern; Escape schließt nur das Menü – Dialog und Text bleiben
    await page.keyboard.type('Ada');
    await expect(menu.locator('.suggestion-item')).toHaveCount(1);
    await expect(menu).toContainText('Ada Admin');
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await expect(box).toContainText('@Ada');

    // Erneut: Enter übernimmt die Erwähnung, sendet aber nicht
    for (let i = 0; i < 4; i++) await page.keyboard.press('Backspace');
    await page.keyboard.type('@Ada');
    await expect(menu).toContainText('Ada Admin');
    await page.keyboard.press('Enter');
    await expect(box.locator('.mention')).toHaveText('@Ada Admin');
    await expect(chat.locator('.comment-text')).toHaveCount(0);

    // Strg+Enter sendet; die Erwähnung steht hervorgehoben in der Nachricht
    await page.keyboard.type(' bitte ansehen');
    await page.keyboard.press('Control+Enter');
    await expect(chat.locator('.comment-text .mention')).toHaveText('@Ada Admin');
    await expectAccessible(page, '[role="dialog"]');

    // Ada wird benachrichtigt – mit Verweis direkt auf die Aufgabe
    const admin = await browser.newContext({ storageState: AUTH.admin, baseURL });
    try {
      await expect
        .poll(async () => {
          const res = await admin.request.get('/api/v1/me/notifications');
          const items = ((await res.json()).items ?? []) as { type: string; link: string; title: string }[];
          return items.filter((n) => n.type === 'mention' && n.link.endsWith(`task=${task.id}`)).map((n) => n.title);
        })
        .toEqual([expect.stringMatching(/^Erika Editor hat dich in der Aufgabe „Erwähnung/)]);
    } finally {
      await admin.close();
    }
  });

  test('Chat in der Suche und Ungelesen-Zeichen: Treffer springt zur Nachricht, Zeichen verschwindet beim Öffnen', async ({ page, request, browser, baseURL, seed }) => {
    // Eigene Aufgabe; die Nachricht schreibt Ada – für Erika (angemeldet) ist sie damit ungelesen
    const title = unique('Abstimmung');
    const word = unique('Kranwagen').replace(/[^A-Za-z0-9]/g, '');
    const created = await request.post(`/api/v1/boards/${seed.boardId}/tasks`, { data: { title }, headers: { 'X-Knowstead-Client': 'e2e' } });
    expect(created.ok(), await created.text()).toBe(true);
    const task = (await created.json()) as { id: number };
    const admin = await browser.newContext({ storageState: AUTH.admin, baseURL });
    const messageId = await (async () => {
      try {
        const headers = { 'X-Knowstead-Client': 'e2e' };
        await admin.request.post(`/api/v1/tasks/${task.id}/comments`, { data: { body: '<p>Erste Rückmeldung vom Lieferanten.</p>' }, headers });
        const sent = await admin.request.post(`/api/v1/tasks/${task.id}/comments`, { data: { body: `<p>Für Freitag ist der ${word} bestellt.</p>` }, headers });
        expect(sent.ok(), await sent.text()).toBe(true);
        return ((await sent.json()) as { id: number }).id;
      } finally {
        await admin.close();
      }
    })();

    // Karte im Plan: Zähler mit Ungelesen-Zeichen – nicht nur über die Farbe erkennbar
    await page.goto(`/s/${seed.spaceKey}/tasks?board=${seed.boardId}`);
    await ready(page);
    const card = page.locator('.task-card').filter({ hasText: title });
    const badge = card.locator('.badge.chat-unread');
    await expect(badge).toHaveAttribute('title', '2 neue Nachrichten im Chat');
    await expect(badge.locator('.chat-unread-dot')).toBeVisible();

    // Suche: Das Wort steht nur im Chat – der Treffer zeigt den Auszug und führt zur Nachricht
    await page.goto(`/search?q=${word}`);
    await ready(page);
    const hit = page.locator('.list-item').filter({ hasText: title });
    await expect(hit.locator('.search-chat-hit')).toContainText('Im Chat · Ada Admin:');
    await expect(hit.locator('.search-chat-hit mark')).toHaveText(word);
    await hit.getByRole('link', { name: title }).click();
    await expect(page).toHaveURL(new RegExp(`task=${task.id}&comment=${messageId}`));
    const dialog = page.getByRole('dialog', { name: 'Aufgabe' });
    const target = dialog.locator(`#task-comment-${messageId}`);
    await expect(target).toHaveClass(/is-target/);
    await expect(target).toBeInViewport();
    await expectAccessible(page, '[role="dialog"]');

    // Chat war offen: Das Zeichen ist weg – auch nach neuem Laden
    await dialog.getByRole('button', { name: 'Abbrechen' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(card.locator('.badge.chat-unread')).toHaveCount(0);
    await page.reload();
    await ready(page);
    await expect(page.locator('.task-card').filter({ hasText: title }).locator('.badge').filter({ hasText: '2' })).toHaveAttribute('title', '2 Nachrichten im Chat');
  });
});

test.describe('Prüfung und Freigabe', () => {
  test.use({ storageState: AUTH.editor });

  test('Zugewiesene Prüfung freigeben', async ({ page, seed }) => {
    await page.goto('/reviews');
    await ready(page);
    const row = page.locator('.review-card').filter({ hasText: 'Richtlinie zur Prüfung' });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Freigeben' }).click();
    await expect(page.getByText('Seite freigegeben')).toBeVisible();
    await page.goto(`/s/${seed.spaceKey}/p/${seed.reviewPageId}`);
    await expect(page.getByText('Freigegeben').first()).toBeVisible();
  });
});

test.describe('Anhänge und Export', () => {
  test.use({ storageState: AUTH.editor });

  test('Datei hochladen, löschen und wiederherstellen', async ({ page, seed }) => {
    await page.goto(`/s/${seed.spaceKey}/p/${seed.childPageId}`);
    await ready(page);
    const panel = page.locator('#attachments');
    const name = `${unique('bericht').replace(' ', '-')}.txt`;
    await panel.locator('input[type="file"]').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from('Inhalt des Berichts') });
    await expect(page.getByText('1 Datei(en) hochgeladen')).toBeVisible();
    const card = panel.locator('.attachment-card').filter({ hasText: name });
    await expect(card).toBeVisible();

    await card.getByRole('button', { name: 'Löschen' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Löschen' }).click();
    await expect(card).toHaveCount(0);
    await panel.getByLabel('Gelöschte anzeigen').check();
    await panel.locator('.attachment-card').filter({ hasText: name }).getByRole('button', { name: 'Wiederherstellen' }).click();
    await panel.getByLabel('Gelöschte anzeigen').uncheck();
    await expect(panel.locator('.attachment-card').filter({ hasText: name })).toBeVisible();
  });

  test('Seite als PDF und Markdown exportieren', async ({ page, seed }) => {
    test.slow();
    await page.goto(`/s/${seed.spaceKey}/p/${seed.richPageId}`);
    await ready(page);
    for (const format of [
      { label: 'PDF', ext: /\.pdf$/, magic: '%PDF' },
      { label: 'Markdown', ext: /\.(md|zip)$/, magic: '' },
    ]) {
      await page.locator('.page-toolbar').getByRole('button', { name: 'Mehr', exact: true }).last().click();
      await page.getByRole('menuitem', { name: 'Exportieren …' }).click();
      const dialog = page.getByRole('dialog', { name: 'Seite exportieren' });
      await expectAccessible(page, '[role="dialog"]');
      await dialog.getByRole('radio', { name: new RegExp(format.label) }).click();
      const downloadPromise = page.waitForEvent('download', { timeout: 90_000 });
      await dialog.getByRole('button', { name: 'Exportieren' }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(format.ext);
      const file = await download.path();
      const bytes = fs.readFileSync(file);
      expect(bytes.length).toBeGreaterThan(100);
      if (format.magic) expect(bytes.subarray(0, 4).toString()).toBe(format.magic);
      await expect(dialog).toHaveCount(0);
    }
  });
});
