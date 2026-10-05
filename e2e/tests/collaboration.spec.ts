import { test, expect, ready, expectAccessible } from './support/fixtures';
import { AUTH, VIEWER, unique } from './support/data';

test.describe('Kommentare', () => {
  test.use({ storageState: AUTH.editor });

  test('Kommentieren, antworten und als erledigt markieren', async ({ page, seed }) => {
    await page.goto(`/s/${seed.spaceKey}/p/${seed.childPageId}`);
    await ready(page);
    const panel = page.locator('section.panel').filter({ has: page.getByRole('heading', { name: /Kommentare/ }) });
    const text = unique('Kommentar');
    await panel.getByRole('textbox', { name: /Kommentar schreiben/ }).click();
    await page.keyboard.type(text);
    await panel.getByRole('button', { name: 'Kommentieren' }).click();
    const comment = panel.locator('.comment').filter({ hasText: text }).first();
    await expect(comment).toBeVisible();

    await comment.getByRole('button', { name: 'Antworten' }).click();
    const composer = panel.locator('.comment-replies').last();
    await expectAccessible(page, 'section.panel');
    await composer.getByRole('textbox', { name: 'Antwort schreiben …' }).click();
    await page.keyboard.type('Eine Antwort');
    await composer.getByRole('button', { name: 'Antworten' }).click();
    await expect(panel.getByText('Eine Antwort')).toBeVisible();

    await comment.getByRole('button', { name: 'Erledigt' }).first().click();
    await expect(panel.getByRole('button', { name: /Erledigte anzeigen/ })).toBeVisible();
  });
});

test.describe('Leserechte', () => {
  test.use({ storageState: AUTH.viewer });

  test('Leserin sieht weder Bearbeiten noch Kommentarfeld noch Administration', async ({ page, seed }) => {
    await page.goto(`/s/${seed.spaceKey}/p/${seed.richPageId}`);
    await ready(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Makroseite' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Bearbeiten' })).toHaveCount(0);
    await expect(page.getByText('Du darfst hier nicht kommentieren.')).toBeVisible();

    await page.getByRole('button', { name: VIEWER.displayName }).click();
    await expect(page.getByRole('menuitem', { name: 'Administration' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // Direkter Aufruf der Bearbeitung und Administration
    const editResponse = await page.request.get(`/api/v1/pages/${seed.richPageId}`);
    expect((await editResponse.json()).access.edit).toBe(false);
    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { level: 1, name: 'Benutzer' })).toHaveCount(0);
  });
});

test.describe('Gemeinsames Bearbeiten', () => {
  test('Zwei Personen sehen die Änderungen des anderen live', async ({ browser, seed }) => {
    const erika = await browser.newContext({ storageState: AUTH.editor });
    const ada = await browser.newContext({ storageState: AUTH.admin });
    const p1 = await erika.newPage();
    const p2 = await ada.newPage();
    try {
      // eigene Seite, damit parallele Tests nicht stören
      const created = await p2.request.post('/api/v1/pages', {
        headers: { 'x-knowstead-client': 'e2e' },
        data: { spaceKey: seed.spaceKey, title: unique('Gemeinsam'), content: '<p>Start</p>' },
      });
      const { id } = (await created.json()) as { id: number };
      await p1.goto(`/s/${seed.spaceKey}/edit/${id}`);
      await p2.goto(`/s/${seed.spaceKey}/edit/${id}`);
      await expect(p1.getByText('Live')).toBeVisible({ timeout: 20_000 });
      await expect(p2.getByText('Live')).toBeVisible({ timeout: 20_000 });

      await p1.locator('.editor-page .tiptap').click();
      await p1.keyboard.press('Control+End');
      await p1.keyboard.type(' von Erika');
      await expect(p2.locator('.editor-page .tiptap')).toContainText('von Erika', { timeout: 15_000 });

      await p2.locator('.editor-page .tiptap').click();
      await p2.keyboard.press('Control+End');
      await p2.keyboard.type(' und Ada');
      await expect(p1.locator('.editor-page .tiptap')).toContainText('und Ada', { timeout: 15_000 });
      // Cursor der anderen Person
      await expect(p1.locator('.collab-caret-label', { hasText: 'Ada Admin' })).toBeVisible({ timeout: 15_000 });
    } finally {
      await erika.close();
      await ada.close();
    }
  });
});
